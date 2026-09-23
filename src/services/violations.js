import crypto from 'node:crypto';
import dbService from '../db/database.js';
import { escapeHtml } from './complaints.js';
import qrcodeService from './qrcode.js';
import { getPermitById, updatePermitStatus } from './permits.js';
import { text, number, date, expectedVersion, requireStaff, audit, idempotent, fail } from './validation.js';

export const VIOLATION_TYPES = [
  'Vượt tầng / sai chiều cao công trình',
  'Sai chỉ giới xây dựng / lấn chiếm khoảng lùi',
  'Xây dựng sai nội dung giấy phép / không phép',
  'Không che chắn an toàn / vi phạm vệ sinh môi trường',
  'Khác'
];

export const VIOLATION_STATUSES = [
  { key: 'lập_biên_bản', label: 'Lập biên bản' },
  { key: 'chờ_khắc_phục', label: 'Chờ khắc phục' },
  { key: 'đã_khắc_phục', label: 'Đã khắc phục xong' },
  { key: 'chuyển_cưỡng_chế', label: 'Chuyển xử phạt / Cưỡng chế' }
];

export function generateViolationCode() { return `BBVP-${new Date().getUTCFullYear()}-${crypto.randomBytes(8).toString('hex').toUpperCase()}`; }
export async function createViolation(data,userId,idempotencyKey=null) {
  await requireStaff(userId);
  const permitId=text(data.permit_id,'mã công trình',{required:true,max:200});
  const violationType=text(data.violation_type,'loại vi phạm',{required:true,max:1000});
  const description=text(data.description,'mô tả vi phạm',{required:true});
  if(!['nhẹ','trung_bình','nghiêm_trọng'].includes(data.severity)) fail('Phải chọn mức độ vi phạm hợp lệ');
  if(data.status&&!['lập_biên_bản','chờ_khắc_phục'].includes(data.status)) fail('Trạng thái ban đầu không hợp lệ');
  const deadline=date(data.remedy_deadline,'thời hạn khắc phục');
  const fine=number(data.fine_amount,'số tiền phạt');
  return idempotent('/api/internal/violations',userId,idempotencyKey,data,async db=>{
    const permit=await getPermitById(permitId,true);
    if(!permit) fail('Không tìm thấy công trình',404);
    if(data.inspection_id){
      const inspection=await db.get('SELECT permit_id FROM inspections WHERE id = ?',[data.inspection_id]);
      if(!inspection||inspection.permit_id!==permitId) fail('Phiếu kiểm tra không thuộc công trình này');
    }
    const id=`VP-${crypto.randomUUID()}`;
    const code=generateViolationCode();
    const now=new Date().toISOString();
    const status=data.status||'lập_biên_bản';
    await db.run('INSERT INTO violations (id,permit_id,inspection_id,violation_code,violation_type,severity,status,description,remedy_deadline,fine_amount,created_by,created_at,updated_at,version_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1)',[id,permitId,data.inspection_id||null,code,violationType,data.severity,status,description,deadline,fine,userId,now,now]);
    if(data.severity==='nghiêm_trọng'||data.stop_work===true) await updatePermitStatus(permitId,{status:'Tạm dừng',version_id:permit.version_id},userId);
    const record=await getViolationById(id);
    await db.run('UPDATE violations SET snapshot_json = ? WHERE id = ?',[JSON.stringify(record),id]);
    await audit(db,userId,'CREATE_VIOLATION','violations',id,{permitId,violationCode:code,severity:data.severity});
    return getViolationById(id);
  });
}

export async function getViolations({ permitId = null, status = null, overdueOnly = false } = {}) {
  let sql = `
    SELECT v.*,
           p.permit_number, p.owner_name, p.site_address, p.longitude, p.latitude,
           u.full_name as inspector_name
    FROM violations v
    JOIN permits p ON v.permit_id = p.id
    LEFT JOIN users u ON v.created_by = u.id
    WHERE 1=1
  `;
  const params = [];

  if (permitId) {
    sql += ' AND v.permit_id = ?';
    params.push(permitId);
  }

  if (status) {
    sql += ' AND v.status = ?';
    params.push(status);
  }

  sql += ' ORDER BY v.created_at DESC';

  const rows = await dbService.all(sql, params);
  const now = new Date();
  const nowDateStr = now.toISOString().slice(0, 10);

  const formatted = rows.map(r => {
    let isOverdue = false;
    let daysRemaining = null;

    if (r.remedy_deadline && ['lập_biên_bản', 'chờ_khắc_phục'].includes(r.status)) {
      const deadline = new Date(r.remedy_deadline);
      const diffMs = deadline.getTime() - now.getTime();
      daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
      isOverdue = r.remedy_deadline < nowDateStr;
    }

    return {
      ...r,
      isOverdue,
      daysRemaining
    };
  });

  if (overdueOnly) {
    return formatted.filter(r => r.isOverdue);
  }

  return formatted;
}

export async function getViolationById(id) {
  const v = await dbService.get(
    `SELECT v.*,
            p.permit_number, p.owner_name, p.site_address, p.construction_type, p.floors_text,
            p.building_area, p.land_area, p.longitude, p.latitude,
            u.full_name as inspector_name
     FROM violations v
     JOIN permits p ON v.permit_id = p.id
     LEFT JOIN users u ON v.created_by = u.id
     WHERE v.id = ?`,
    [id]
  );
  if (!v) return null;

  const now = new Date();
  const nowDateStr = now.toISOString().slice(0, 10);
  let isOverdue = false;
  let daysRemaining = null;

  if (v.remedy_deadline && ['lập_biên_bản', 'chờ_khắc_phục'].includes(v.status)) {
    const deadline = new Date(v.remedy_deadline);
    const diffMs = deadline.getTime() - now.getTime();
    daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    isOverdue = v.remedy_deadline < nowDateStr;
  }

  return {
    ...v,
    isOverdue,
    daysRemaining
  };
}

export async function updateViolationStatus(id,{status,notes,fine_amount,version_id},userId) {
  await requireStaff(userId,['admin','coordinator']);
  return dbService.transaction(async db=>{
    const violation=await getViolationById(id);
    if(!violation) fail('Không tìm thấy biên bản vi phạm',404);
    expectedVersion(version_id,violation.version_id);
    const transitions={'lập_biên_bản':['chờ_khắc_phục','chuyển_cưỡng_chế'],'chờ_khắc_phục':['đã_khắc_phục','chuyển_cưỡng_chế'],'chuyển_cưỡng_chế':['đã_khắc_phục'],'đã_khắc_phục':[]};
    if(!transitions[violation.status]?.includes(status)) fail('Chuyển trạng thái vi phạm không hợp lệ',409);
    const note=text(notes,'ghi chú cập nhật');
    const fine=fine_amount==null?violation.fine_amount:number(fine_amount,'số tiền phạt');
    const now=new Date().toISOString();
    const result=await db.run('UPDATE violations SET status = ?,fine_amount = ?,description = ?,updated_at = ?,version_id = version_id + 1 WHERE id = ? AND version_id = ?',[status,fine,violation.description+(note?`\n[Cập nhật ${now.slice(0,10)}]: ${note}`:''),now,id,version_id]);
    if(Number(result.changes)!==1) fail('Biên bản đã được cập nhật',409,'VERSION_CONFLICT');
    // Resolving a violation does not cancel a separate stop-work decision.
    await audit(db,userId,'UPDATE_VIOLATION_STATUS','violations',id,{oldStatus:violation.status,newStatus:status,notes:note});
    return getViolationById(id);
  });
}

export async function generateViolationPrintHtml(id) {
  const stored = await getViolationById(id);
  const v = stored ? { ...stored } : null;
  if (!v) throw new Error(`Không tìm thấy biên bản vi phạm ${id}`);

  if (!v.snapshot_json) fail('Biên bản cũ chưa có bản chụp dữ liệu, cần đối soát trước khi in',409);
  const snapshot = JSON.parse(v.snapshot_json);
  Object.assign(v,snapshot);
  const rawPermitNumber = v.permit_number;
  for (const key of Object.keys(v)) if (typeof v[key] === 'string') v[key] = escapeHtml(v[key]);
  const createdDate = new Date(v.created_at);
  const day = String(createdDate.getDate()).padStart(2, '0');
  const month = String(createdDate.getMonth() + 1).padStart(2, '0');
  const year = createdDate.getFullYear();
  const qrUrl = qrcodeService.getPermitQrUrl(rawPermitNumber);
  const qrSvg = qrcodeService.generateQrSvg(qrUrl, { size: 85, padding: 2 });

  return `<!DOCTYPE html>
<html lang="vi">
<head>
  <meta charset="UTF-8">
  <title>Biên bản vi phạm - ${v.violation_code}</title>
  <style>
    @page { size: A4 portrait; margin: 20mm 15mm 20mm 20mm; }
    body { font-family: "Times New Roman", Times, serif; font-size: 13pt; line-height: 1.4; color: #000; margin: 0; padding: 20px; }
    .header-table { width: 100%; border-collapse: collapse; margin-bottom: 15px; }
    .header-table td { vertical-align: top; }
    .header-left { width: 40%; font-size: 12pt; text-align: center; }
    .header-right { width: 45%; font-size: 12pt; text-align: center; }
    .header-qr { width: 15%; text-align: center; font-size: 10px; }
    .header-qr svg { display: block; margin: 0 auto 3px; border: 1px solid #ccc; }
    .bold { font-weight: bold; }
    .italic { font-style: italic; }
    .title { text-align: center; font-size: 15pt; font-weight: bold; margin: 20px 0 8px 0; text-transform: uppercase; }
    .sub-title { text-align: center; font-style: italic; margin-bottom: 20px; }
    .section { margin-top: 15px; }
    .info-table { width: 100%; border-collapse: collapse; margin: 15px 0; }
    .info-table th, .info-table td { border: 1px solid #000; padding: 6px 10px; font-size: 12pt; }
    .info-table th { background: #f0f0f0; }
    .signatures { width: 100%; margin-top: 40px; border-collapse: collapse; page-break-inside: avoid; }
    .signatures td { text-align: center; vertical-align: top; width: 50%; font-size: 12pt; padding-bottom: 80px; }
    .btn-print { display: block; margin: 0 auto 20px auto; padding: 10px 20px; background: #0070f3; color: #fff; border: none; border-radius: 4px; cursor: pointer; font-size: 14px; font-family: sans-serif; }
    @media print { .btn-print { display: none; } body { padding: 0; } }
  </style>
</head>
<body>
  <button class="btn-print" onclick="window.print()">In Biên bản này (Ctrl + P)</button>

  <table class="header-table">
    <tr>
      <td class="header-left">
        TỈNH SƠN LA<br>
        <span class="bold">UBND PHƯỜNG THẢO NGUYÊN</span><br>
        <span class="bold">TỔ QUẢN LÝ TRẬT TỰ XÂY DỰNG</span><br>
        Số: ${v.violation_code}
      </td>
      <td class="header-right">
        <span class="bold">CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM</span><br>
        <span class="bold">Độc lập - Tự do - Hạnh phúc</span><br>
        -----------------------<br>
        <span class="italic">Thảo Nguyên, ngày ${day} tháng ${month} năm ${year}</span>
      </td>
      <td class="header-qr">
        ${qrSvg}
        <span>Mã tra cứu</span>
      </td>
    </tr>
  </table>

  <div class="title">BIÊN BẢN VI PHẠM HÀNH CHÍNH<br>VỀ TRẬT TỰ XÂY DỰNG</div>
  <div class="sub-title">(Căn cứ Luật Xây dựng và Nghị định số 16/2022/NĐ-CP của Chính phủ)</div>

  <div class="section">
    Hôm nay, hồi ${createdDate.getHours()} giờ ${createdDate.getMinutes()} phút, ngày ${day} tháng ${month} năm ${year}, tại địa điểm công trình xây dựng:<br>
    - <span class="bold">Địa chỉ:</span> ${v.site_address}, phường Thảo Nguyên, tỉnh Sơn La.<br>
    - <span class="bold">Cán bộ lập biên bản:</span> ${v.inspector_name || 'Đội kiểm tra trật tự xây dựng'}.
  </div>

  <div class="section">
    <span class="bold">I. ĐỐI TƯỢNG VÀ THÔNG TIN CÔNG TRÌNH:</span><br>
    - Tên chủ hộ / Chủ đầu tư: <span class="bold">${v.owner_name}</span><br>
    - Giấy phép xây dựng số: <span class="bold">${v.permit_number}</span><br>
    - Loại công trình: ${v.construction_type || 'Nhà ở riêng lẻ'} - Quy mô cấp phép: ${v.floors_text || 'Theo hồ sơ'}<br>
    - Tọa độ kiểm tra: [Kinh độ: ${v.longitude}, Vĩ độ: ${v.latitude}]
  </div>

  <div class="section">
    <span class="bold">II. HÀNH VI VI PHẠM ĐƯỢC XÁC LẬP TẠI HIỆN TRƯỜNG:</span>
    <table class="info-table">
      <tr>
        <th style="width: 25%;">Hạng mục</th>
        <th>Nội dung ghi nhận thực tế</th>
      </tr>
      <tr>
        <td class="bold">Loại vi phạm</td>
        <td>${v.violation_type} (Mức độ: <span class="bold">${v.severity.toUpperCase()}</span>)</td>
      </tr>
      <tr>
        <td class="bold">Mô tả hành vi</td>
        <td>${v.description.replace(/\n/g, '<br>')}</td>
      </tr>
      <tr>
        <td class="bold">Thời hạn khắc phục</td>
        <td><span class="bold">Trước ngày ${v.remedy_deadline || 'Theo yêu cầu'}</span></td>
      </tr>
      <tr>
        <td class="bold">Dự kiến tiền phạt</td>
        <td>${v.fine_amount ? Number(v.fine_amount).toLocaleString('vi-VN') + ' VNĐ' : 'Chờ quyết định xử phạt chính thức'}</td>
      </tr>
    </table>
  </div>

  <div class="section">
    <span class="bold">III. YÊU CẦU ĐỐI VỚI CHỦ ĐẦU TƯ:</span><br>
    1. Yêu cầu chủ hộ/chủ đầu tư dừng ngay các hành vi vi phạm trật tự xây dựng nêu trên.<br>
    2. Tự giác tháo dỡ phần xây dựng vi phạm hoặc bổ sung khắc phục đúng quy định trước thời hạn ấn định.<br>
    3. Hết thời hạn nêu trên nếu không chấp hành, Tổ công tác sẽ tham mưu UBND phường ban hành Quyết định áp dụng biện pháp cưỡng chế xử lý theo quy định của pháp luật.
  </div>

  <table class="signatures">
    <tr>
      <td>
        <span class="bold">CHỦ HỘ / ĐẠI DIỆN CÔNG TRÌNH</span><br>
        <span class="italic">(Ký, ghi rõ họ tên)</span>
      </td>
      <td>
        <span class="bold">CÁN BỘ LẬP BIÊN BẢN</span><br>
        <span class="italic">(Ký, ghi rõ họ tên)</span>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

export default {
  VIOLATION_TYPES,
  VIOLATION_STATUSES,
  generateViolationCode,
  createViolation,
  getViolations,
  getViolationById,
  updateViolationStatus,
  generateViolationPrintHtml
};
