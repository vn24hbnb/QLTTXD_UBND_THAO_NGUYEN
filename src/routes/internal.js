import authService from '../services/auth.js';
import permitsService from '../services/permits.js';
import complaintsService from '../services/complaints.js';
import inspectionsService from '../services/inspections.js';
import reportsService from '../services/reports.js';
import storageService from '../services/storage.js';
import gisService from '../services/gis.js';
import batchImportService from '../services/batch_import.js';
import violationsService from '../services/violations.js';
import qrcodeService from '../services/qrcode.js';
import { OFFICERS, APPROVERS, fail, sendJson, sendError, dataResponse, requireRole, expectedOrigins, parseBody, queryOptions, sessionCookie, csv, html, svg } from '../http/helpers.js';
import { checkRateLimit } from '../http/rate_limit.js';

import { NOT_HANDLED } from './public.js';

/** Route nội bộ cho cán bộ: đăng nhập, nghiệp vụ, báo cáo và tệp. */
export async function handleInternal({ req, res, url, pathname, method, ip, currentUser, sessionToken }) {
  let match;
  if (pathname === '/api/internal/auth/login' && method === 'POST') {
    const body = await parseBody(req);
    const identity = typeof body.username === 'string' ? body.username.trim().toLowerCase().slice(0, 100) : '';
    if (!await checkRateLimit(`login-ip:${ip}`, 12) || !await checkRateLimit(`login-account:${identity}`, 12)) {
      res.setHeader('Retry-After', '60');
      return sendError(res, 429, 'Đã thử đăng nhập quá nhiều lần; vui lòng chờ 1 phút', 'RATE_LIMITED');
    }
    const result = await authService.authenticate(body.username, body.password, body.totp_token);
    if (!result.success) return sendJson(res, 401, result);
    if (!OFFICERS.includes(result.user.role)) {
      await authService.deleteSession(result.session.token);
      return sendError(res, 403, 'Tài khoản này không có quyền truy cập nghiệp vụ cán bộ', 'FORBIDDEN');
    }
    res.setHeader('Set-Cookie', sessionCookie(result.session.token));
    return sendJson(res, 200, { success: true, user: result.user });
  }
  if (pathname === '/api/internal/auth/logout' && method === 'POST') {
    requireRole(currentUser);
    await authService.deleteSession(sessionToken);
    res.setHeader('Set-Cookie', sessionCookie('', 0));
    return sendJson(res, 200, { success: true, message: 'Đã đăng xuất thành công' });
  }
  if (pathname === '/api/internal/auth/me' && method === 'GET') {
    requireRole(currentUser);
    return sendJson(res, 200, { success: true, user: currentUser });
  }

  if (pathname.startsWith('/api/internal/')) {
    requireRole(currentUser);
    const userId = currentUser.user_id;
    res.restrictReporterContacts = currentUser.role === 'inspector';
    if (currentUser.role === 'receptionist') {
      // Cán bộ tiếp nhận chỉ xem hồ sơ đã công bố/nội bộ ở mức tra cứu và xử lý bước tiếp nhận phản ánh.
      const allowed = (method === 'GET' && (/^\/api\/internal\/permits(\/[^/]+)?$/.test(pathname) || pathname === '/api/internal/complaints'))
        || (method === 'POST' && /^\/api\/internal\/complaints\/[^/]+\/step$/.test(pathname));
      if (!allowed) throw fail('Bạn không có quyền thực hiện chức năng này', 403, 'FORBIDDEN');
    }
    if (pathname === '/api/internal/permits' && method === 'GET') return dataResponse(res, await permitsService.getInternalPermits(queryOptions(url)));
    if (pathname === '/api/internal/permits' && method === 'POST') {
      requireRole(currentUser, APPROVERS);
      const body = await parseBody(req);
      const { publish, ...permitData } = body;
      return dataResponse(res, await permitsService.createPermit(permitData, userId, req.headers['idempotency-key'], { publish: publish === true }), 201, 'Đã tạo hồ sơ giấy phép');
    }
    if (pathname === '/api/internal/permits/publish-all' && method === 'POST') {
    requireRole(currentUser, APPROVERS);
    return dataResponse(res, await permitsService.publishPermitsBulk(userId));
  }
  match = pathname.match(/^\/api\/internal\/permits\/([^/]+)\/publication$/);
    if (match && method === 'POST') {
      requireRole(currentUser, APPROVERS);
      return dataResponse(res, await permitsService.publishPermit(match[1], await parseBody(req), userId));
    }
    match = pathname.match(/^\/api\/internal\/permits\/([^/]+)\/resume$/);
    if (match && method === 'POST') {
      requireRole(currentUser, APPROVERS);
      return dataResponse(res, await permitsService.resumePermit(match[1], await parseBody(req), userId));
    }
    match = pathname.match(/^\/api\/internal\/permits\/([^/]+)$/);
    if (match && method === 'GET') {
      const permit = await permitsService.getPermitById(match[1], true);
      if (!permit) throw fail('Không tìm thấy hồ sơ', 404, 'NOT_FOUND');
      return dataResponse(res, permit);
    }
    if (pathname === '/api/internal/inspections' && method === 'GET') {
      const permitId = url.searchParams.get('permit_id');
      if (!permitId) throw fail('Thiếu hồ sơ công trình');
      return dataResponse(res, await inspectionsService.getInspectionsByPermit(permitId));
    }
    if (pathname === '/api/internal/inspections' && method === 'POST') return dataResponse(res, await inspectionsService.submitInspection(await parseBody(req), userId, req.headers['idempotency-key']), 201, 'Đã lập phiếu kiểm tra');
    match = pathname.match(/^\/api\/internal\/inspections\/([^/]+)\/approve$/);
    if (match && method === 'POST') {
      requireRole(currentUser, APPROVERS);
      return dataResponse(res, await inspectionsService.approveInspection(match[1], userId, await parseBody(req)));
    }
    match = pathname.match(/^\/api\/internal\/inspections\/([^/]+)\/print$/);
    if (match && method === 'GET') return html(res, await inspectionsService.generateInspectionPrintHtml(match[1]));
    if (pathname === '/api/internal/complaints' && method === 'GET') {
      const list = await complaintsService.getInternalComplaints(queryOptions(url));
      return dataResponse(res, list);
    }
    match = pathname.match(/^\/api\/internal\/complaints\/([^/]+)\/step$/);
    if (match && method === 'POST') {
      const body = await parseBody(req);
      if (currentUser.role === 'receptionist' && ![1, 2].includes(body.step)) throw fail('Cán bộ tiếp nhận chỉ thực hiện bước tiếp nhận và phân công', 403, 'FORBIDDEN');
      if (currentUser.role === 'inspector') {
        if (![3, 4].includes(body.step) || body.reply !== undefined || body.assigned_to !== undefined || body.approved_read !== undefined) throw fail('Chỉ người điều phối mới có quyền phân công và phê duyệt phản hồi', 403, 'FORBIDDEN');
        const complaint = await complaintsService.getComplaintById(match[1]);
        if (!complaint || complaint.assigned_to !== userId) throw fail('Phản ánh chưa được phân công cho bạn', 403, 'FORBIDDEN');
      }
      return dataResponse(res, await complaintsService.updateComplaintStep(match[1], body, userId));
    }
    match = pathname.match(/^\/api\/internal\/complaints\/([^/]+)\/reopen$/);
    if (match && method === 'POST') {
      requireRole(currentUser, APPROVERS);
      return dataResponse(res, await complaintsService.reopenComplaint(match[1], userId, await parseBody(req)));
    }
    match = pathname.match(/^\/api\/internal\/complaints\/([^/]+)\/duplicates$/);
    if (match && method === 'GET') {
      requireRole(currentUser, APPROVERS);
      const radius = Number(url.searchParams.get('radius') ?? 100);
      if (!Number.isFinite(radius) || radius <= 0 || radius > 1000) throw fail('Bán kính tra cứu không hợp lệ');
      return dataResponse(res, await complaintsService.findDuplicateComplaints(match[1], radius));
    }
    match = pathname.match(/^\/api\/internal\/complaints\/([^/]+)\/merge$/);
    if (match && method === 'POST') {
      requireRole(currentUser, APPROVERS);
      const body = await parseBody(req);
      return dataResponse(res, await complaintsService.mergeComplaints(match[1], body.sourceIds, body.reason, userId, body));
    }
    if (pathname === '/api/internal/batch-import/preview' && method === 'POST') {
      requireRole(currentUser, APPROVERS);
      const body = await parseBody(req);
      if (typeof body.csvText !== 'string' || !body.csvText.trim()) throw fail('Thiếu nội dung tệp CSV');
      return dataResponse(res, await batchImportService.previewBatch(body.csvText));
    }
    if (pathname === '/api/internal/batch-import/commit' && method === 'POST') {
      requireRole(currentUser, APPROVERS);
      const body = await parseBody(req);
      if (!Array.isArray(body.validRows) || !body.validRows.length || body.validRows.length > 1000) throw fail('Cần từ 1 đến 1000 hồ sơ hợp lệ');
      return dataResponse(res, await batchImportService.commitBatch(body.validRows, userId, body.filename || 'import.csv', req.headers['idempotency-key'], { publish: body.publish === true }), 201);
    }
    if (pathname === '/api/internal/violations' && method === 'GET') return dataResponse(res, await violationsService.getViolations({ permitId: url.searchParams.get('permit_id'), status: url.searchParams.get('status'), overdueOnly: url.searchParams.get('overdue_only') === 'true' }));
    if (pathname === '/api/internal/violations' && method === 'POST') return dataResponse(res, await violationsService.createViolation(await parseBody(req), userId, req.headers['idempotency-key']), 201);
    match = pathname.match(/^\/api\/internal\/violations\/([^/]+)\/status$/);
    if (match && method === 'POST') {
      requireRole(currentUser, APPROVERS);
      return dataResponse(res, await violationsService.updateViolationStatus(match[1], await parseBody(req), userId));
    }
    match = pathname.match(/^\/api\/internal\/violations\/([^/]+)\/print$/);
    if (match && method === 'GET') return html(res, await violationsService.generateViolationPrintHtml(match[1]));
    match = pathname.match(/^\/api\/internal\/violations\/([^/]+)$/);
    if (match && method === 'GET') {
      const item = await violationsService.getViolationById(match[1]);
      if (!item) throw fail('Không tìm thấy biên bản', 404, 'NOT_FOUND');
      return dataResponse(res, item);
    }
    if (pathname === '/api/internal/reports/summary' && method === 'GET') return dataResponse(res, await reportsService.getSummaryReports());
    if (pathname === '/api/internal/reports/sub-areas' && method === 'GET') return dataResponse(res, await reportsService.getResidentialGroupStats());
    if (pathname === '/api/internal/reports/overdue' && method === 'GET') {
      const result = await reportsService.getOverdueTasks();
      return dataResponse(res, result);
    }
    if (pathname === '/api/internal/reports/export-csv' && method === 'GET') return csv(res, await reportsService.exportPermitsCsv(true), 'Bao_cao_cong_trinh.csv');
    if (pathname === '/api/internal/audit-logs' && method === 'GET') {
      requireRole(currentUser, ['admin']);
      return dataResponse(res, await reportsService.getAuditLogsReport({ ...queryOptions(url), action: url.searchParams.get('action'), entityType: url.searchParams.get('entity_type') }));
    }
    if (pathname === '/api/internal/reports/audit-logs/export-csv' && method === 'GET') {
      requireRole(currentUser, ['admin']);
      return csv(res, await reportsService.exportAuditLogsCsv(), 'Nhat_ky_kiem_toan.csv');
    }
    if (pathname === '/api/internal/files/upload' && method === 'POST') {
      const body = await parseBody(req);
      if (typeof body.base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.base64)) throw fail('Dữ liệu ảnh không hợp lệ');
      return dataResponse(res, await storageService.saveFile({ buffer: Buffer.from(body.base64, 'base64'), originalName: body.fileName, mimeType: body.mimeType, ownerId: userId }), 201);
    }
  }
  match = pathname.match(/^\/api\/files\/([^/]+)$/);
  if (match && method === 'GET') {
    requireRole(currentUser);
    const file = await storageService.getFile(match[1], currentUser);
    if (!file) throw fail('Không tìm thấy tệp', 404, 'NOT_FOUND');
    res.writeHead(200, { 'Content-Type': file.mimeType, 'Content-Disposition': `inline; filename="${file.fileName}"` });
    return res.end(file.buffer);
  }
  return NOT_HANDLED;
}
