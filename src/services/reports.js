import dbService from '../db/database.js';
import { INSPECTION_STAGES } from './inspections.js';

export async function getResidentialGroupStats() {
  const groups = [
    'Tổ 1', 'Tổ 2', 'Tổ 3', 'Tổ 4',
    'Tổ 5', 'Tổ 6', 'Tổ 7', 'Tổ 8'
  ];

  const permits = await dbService.all('SELECT id, site_address, status FROM permits');
  const complaints = await dbService.all('SELECT id, location_text, status_step FROM complaints');
  let violations = [];
  try {
    violations = await dbService.all('SELECT v.id, p.site_address, v.status FROM violations v JOIN permits p ON v.permit_id = p.id');
  } catch {}

  const stats = groups.map(g => {
    const regex = new RegExp(String.raw`(?:^|[^\p{L}\p{N}])Tổ(?:\s+dân\s+phố)?\s+${g.slice(3)}(?!\d)`, 'iu');
    const matchedPermits = permits.filter(p => regex.test(p.site_address || ''));
    const matchedComplaints = complaints.filter(c => regex.test(c.location_text || ''));
    const matchedViolations = violations.filter(v => regex.test(v.site_address || ''));

    return {
      groupName: g,
      totalPermits: matchedPermits.length,
      activePermits: matchedPermits.filter(p => ['Đang thi công', 'Cần kiểm tra'].includes(p.status)).length,
      completedPermits: matchedPermits.filter(p => p.status === 'Đã hoàn thành').length,
      complaintsCount: matchedComplaints.length,
      violationsCount: matchedViolations.length
    };
  });

  return stats;
}

export async function getOverdueTasks() {
  const now = new Date();
  const fiveDaysAgo = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString();
  const todayStr = now.toISOString().slice(0, 10);

  const overdueInspections = await dbService.all(
    `SELECT i.*, p.permit_number, p.site_address, u.full_name as inspector_name
     FROM inspections i
     JOIN permits p ON i.permit_id = p.id
     LEFT JOIN users u ON i.inspector_id = u.id
     WHERE i.status IN ('draft', 'pending_approval')
       AND i.created_at <= ?
     ORDER BY i.created_at ASC`,
    [fiveDaysAgo]
  );

  const overdueComplaints = await dbService.all(
    `SELECT * FROM complaints
     WHERE status_step < 4
       AND (master_complaint_id IS NULL OR master_complaint_id = '')
       AND created_at <= ?
     ORDER BY created_at ASC`,
    [fiveDaysAgo]
  );

  let overdueViolations = [];
  try {
    overdueViolations = await dbService.all(
      `SELECT v.*, p.permit_number, p.owner_name, p.site_address
       FROM violations v
       JOIN permits p ON v.permit_id = p.id
       WHERE v.status IN ('lập_biên_bản', 'chờ_khắc_phục')
         AND v.remedy_deadline < ?
       ORDER BY v.remedy_deadline ASC`,
      [todayStr]
    );
  } catch {}

  return {
    overdueInspections,
    overdueComplaints,
    overdueViolations,
    totalOverdueCount: overdueInspections.length + overdueComplaints.length + overdueViolations.length
  };
}

export async function getSummaryReports() {
  const permits = await dbService.all('SELECT status, current_stage FROM permits');
  const complaints = await dbService.all('SELECT status_step FROM complaints');

  const totalPermits = permits.length;
  const needCheck = permits.filter(p => p.status === 'Cần kiểm tra').length;
  const completed = permits.filter(p => p.status === 'Đã hoàn thành').length;
  const pendingComplaints = complaints.filter(c => c.status_step < 5).length;

  // Thống kê theo 4 mốc
  const stageStats = INSPECTION_STAGES.map((name, i) => {
    const count = permits.filter(p => p.current_stage > i).length;
    return { stageIndex: i, name, count };
  });

  const residentialStats = await getResidentialGroupStats();
  const overdueTasks = await getOverdueTasks();

  let violationCount = 0;
  let pendingViolations = 0;
  try {
    const violations = await dbService.all('SELECT status FROM violations');
    violationCount = violations.length;
    pendingViolations = violations.filter(v => ['lập_biên_bản', 'chờ_khắc_phục'].includes(v.status)).length;
  } catch {}

  return {
    totalPermits,
    needCheck,
    completed,
    pendingComplaints,
    stageStats,
    residentialStats,
    overdueTasks,
    violationStats: {
      total: violationCount,
      pending: pendingViolations
    }
  };
}

/**
 * Ngăn chặn tấn công CSV Formula Injection
 * Nếu ô bắt đầu bằng =, +, -, @ thì chèn dấu nháy đơn ' ở đầu
 */
export function sanitizeCsvField(val) {
  if (val == null) return '';
  let str = String(val).replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  // Thoát dấu nháy kép
  return `"${str.replace(/"/g, '""')}"`;
}

export async function exportPermitsCsv(isInternal = false) {
  let permits;
  if (isInternal) {
    permits = await dbService.all(
      `SELECT permit_number, owner_name, site_address, construction_type,
              land_area, building_area, floors_text, status, current_stage, issue_date
       FROM permits ORDER BY permit_number ASC`
    );
  } else {
    // Bản xuất công khai - ẩn thông tin cá nhân
    permits = await dbService.all(
      `SELECT permit_number, site_address, construction_type,
              building_area, floors_text, status, current_stage, issue_date
       FROM permits WHERE is_public = 1 ORDER BY permit_number ASC`
    );
  }

  const headers = isInternal
    ? ['Số giấy phép', 'Chủ hộ', 'Địa điểm xây dựng', 'Loại công trình', 'DT đất (m²)', 'DT xây dựng (m²)', 'Số tầng', 'Trạng thái', 'Mốc hoàn thành', 'Ngày cấp']
    : ['Số giấy phép', 'Địa điểm xây dựng', 'Loại công trình', 'DT xây dựng (m²)', 'Số tầng', 'Trạng thái', 'Mốc hoàn thành', 'Ngày cấp'];

  const rows = permits.map(p => {
    if (isInternal) {
      return [
        p.permit_number,
        p.owner_name,
        p.site_address,
        p.construction_type,
        p.land_area,
        p.building_area,
        p.floors_text,
        p.status,
        `${p.current_stage}/4`,
        p.issue_date
      ].map(sanitizeCsvField);
    } else {
      return [
        p.permit_number,
        p.site_address,
        p.construction_type,
        p.building_area,
        p.floors_text,
        p.status,
        `${p.current_stage}/4`,
        p.issue_date
      ].map(sanitizeCsvField);
    }
  });

  // UTF-8 BOM (\uFEFF) giúp Excel trên Windows/Mac hiển thị đúng tiếng Việt có dấu
  const csvContent = '\uFEFF' + [headers.map(sanitizeCsvField).join(','), ...rows.map(r => r.join(','))].join('\r\n');
  return csvContent;
}

export async function getAuditLogsReport({ limit = 100, offset = 0, action = null, entityType = null } = {}) {
  let sql = `SELECT a.*, u.full_name as user_full_name, u.role as user_role
             FROM audit_logs a
             LEFT JOIN users u ON a.user_id = u.id
             WHERE 1=1`;
  const params = [];
  if (action) {
    sql += ` AND a.action = ?`;
    params.push(action);
  }
  if (entityType) {
    sql += ` AND a.entity_type = ?`;
    params.push(entityType);
  }
  sql += ` ORDER BY a.id DESC LIMIT ? OFFSET ?`;
  params.push(limit, offset);

  return await dbService.all(sql, params);
}

export async function exportAuditLogsCsv() {
  const logs = await dbService.all(
    `SELECT a.id, a.created_at, a.action, a.entity_type, a.entity_id, a.details, a.ip_address,
            u.username, u.full_name, u.role
     FROM audit_logs a
     LEFT JOIN users u ON a.user_id = u.id
     ORDER BY a.id DESC`
  );

  const headers = [
    'Mã nhật ký', 'Thời điểm (UTC)', 'Hành động', 'Đối tượng', 'Mã đối tượng',
    'Chi tiết', 'Địa chỉ IP', 'Tài khoản', 'Họ tên cán bộ', 'Vai trò'
  ];

  const rows = logs.map(l => [
    l.id,
    l.created_at,
    l.action,
    l.entity_type,
    l.entity_id,
    l.details || '',
    l.ip_address || '',
    l.username || l.user_id || 'Hệ thống',
    l.full_name || '',
    l.role || ''
  ].map(sanitizeCsvField));

  return '\uFEFF' + [headers.map(sanitizeCsvField).join(','), ...rows.map(r => r.join(','))].join('\r\n');
}

export default {
  getSummaryReports,
  getResidentialGroupStats,
  getOverdueTasks,
  sanitizeCsvField,
  exportPermitsCsv,
  getAuditLogsReport,
  exportAuditLogsCsv
};
