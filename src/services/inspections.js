import crypto from 'node:crypto';
import dbService from '../db/database.js';
import { getPermitById, updatePermitStatus } from './permits.js';
import qrcodeService from './qrcode.js';
import storageService from './storage.js';
import { escapeHtml } from './complaints.js';
import { text, number, date, fail, expectedVersion, requireStaff, audit, idempotent } from './validation.js';

export const INSPECTION_STAGES = ['Trước khi đào móng','Xong phần móng tầng 1','Đổ mái tầng 1','Hoàn thành công trình'];

async function validatePhotos(photos, user, required) {
  if (!Array.isArray(photos) || photos.length > 5 || (required && photos.length < 1)) fail('Phiếu gửi duyệt phải có từ 1 đến 5 ảnh JPEG/PNG thực tế');
  const names = new Set();
  const result = [];
  for (const photo of photos) {
    const fileName = text(photo?.fileName, 'tên ảnh', { required: true, max: 255 });
    if (names.has(fileName)) fail('Không được đính kèm cùng một ảnh nhiều lần');
    names.add(fileName);
    const file = await dbService.get('SELECT file_name,mime_type,file_size,sha256,owner_id FROM files WHERE file_name = ?',[fileName]);
    if (!file || !['image/jpeg','image/png'].includes(file.mime_type)) fail('Ảnh chưa được tải lên hoặc không đúng định dạng');
    if (user.role === 'inspector' && file.owner_id !== user.id) fail('Bạn không có quyền sử dụng ảnh này',403);
    const stored = await storageService.getFile(fileName, user);
    if (!stored) fail('Không tìm thấy tệp ảnh đã tải lên');
    result.push({...file,caption:text(photo.caption,'chú thích ảnh',{max:1000})});
  }
  return result;
}
export async function submitInspection(data, userId, idempotencyKey = null) {
  const user = await requireStaff(userId);
  const permitId = text(data.permit_id,'mã công trình',{required:true,max:200});
  const stage = number(data.stage_index,'mốc kiểm tra',{required:true,integer:true,max:3});
  const status = data.status === 'draft' ? 'draft' : 'pending_approval';
  if (data.status && !['draft','pending_approval'].includes(data.status)) fail('Trạng thái phiếu không hợp lệ');
  const measured = {
    measured_area:number(data.measured_area,'diện tích thực tế'),
    measured_setback:number(data.measured_setback,'khoảng lùi trước'),
    measured_setback_rear:number(data.measured_setback_rear,'khoảng lùi sau'),
    measured_floors:number(data.measured_floors,'số tầng thực tế',{integer:true,max:300})
  };
  const inspectDate = date(data.inspect_date,'ngày kiểm tra',{required:true});
  const notes = text(data.notes,'ghi chú');
  return idempotent('/api/internal/inspections',userId,idempotencyKey,data,async db => {
    const permit = await getPermitById(permitId,true);
    if (!permit) fail('Không tìm thấy hồ sơ công trình',404);
    const photos = await validatePhotos(data.photos ?? [],user,status === 'pending_approval');
    const id = `insp-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const snapshot = JSON.stringify({permit,recorded_at:now});
    await db.run('INSERT INTO inspections (id,permit_id,stage_index,inspector_id,inspect_date,measured_area,measured_setback,measured_setback_rear,measured_floors,notes,status,snapshot_json,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',[id,permitId,stage,userId,inspectDate,measured.measured_area,measured.measured_setback,measured.measured_setback_rear,measured.measured_floors,notes,status,snapshot,now]);
    for (const photo of photos) await db.run('INSERT INTO inspection_photos (id,inspection_id,file_name,file_size,mime_type,sha256_hash,caption,created_at) VALUES (?,?,?,?,?,?,?,?)',[crypto.randomUUID(),id,photo.file_name,photo.file_size,photo.mime_type,photo.sha256,photo.caption,now]);
    await audit(db,userId,'SUBMIT_INSPECTION','inspections',id,{permit_id:permitId,stage,status});
    return getInspectionById(id);
  });
}
export async function approveInspection(inspectionId, approvedBy, { version_id } = {}) {
  await requireStaff(approvedBy,['admin','coordinator']);
  return dbService.transaction(async db => {
    const insp = await getInspectionById(inspectionId);
    if (!insp) fail('Không tìm thấy phiếu kiểm tra',404);
    if (insp.status !== 'pending_approval') fail('Chỉ phê duyệt phiếu đang chờ duyệt',409);
    expectedVersion(version_id,insp.permit.version_id);
    const previous = await db.all("SELECT DISTINCT stage_index FROM inspections WHERE permit_id = ? AND status = 'approved'",[insp.permit_id]);
    const stages = new Set(previous.map(row => Number(row.stage_index)));
    if (stages.has(insp.stage_index)) fail('Mốc này đã có kết quả được duyệt',409);
    for(let stage=0;stage<insp.stage_index;stage++) if(!stages.has(stage)) fail('Phải duyệt đủ các mốc trước trước khi duyệt mốc này',409);
    const user = await requireStaff(approvedBy,['admin','coordinator']);
    await validatePhotos(insp.photos.map(photo=>({fileName:photo.file_name})),user,true);
    const updated = await db.run("UPDATE inspections SET status = 'approved',approved_by = ?,approved_at = ? WHERE id = ? AND status = 'pending_approval'",[approvedBy,new Date().toISOString(),inspectionId]);
    if(Number(updated.changes ?? updated.rowCount)!==1) fail('Phiếu đã được cập nhật',409);
    stages.add(insp.stage_index);
    let currentStage=0;
    while(stages.has(currentStage)&&currentStage<4) currentStage++;
    const activeStops = await db.get("SELECT COUNT(*) AS count FROM violations WHERE permit_id = ? AND severity = 'nghiêm_trọng' AND status != 'đã_khắc_phục'",[insp.permit_id]);
    const status=insp.permit.status === 'Tạm dừng' || Number(activeStops.count)>0 ? 'Tạm dừng' : currentStage===4?'Đã hoàn thành':'Đang thi công';
    await updatePermitStatus(insp.permit_id,{status,current_stage:currentStage,version_id},approvedBy);
    await audit(db,approvedBy,'APPROVE_INSPECTION','inspections',inspectionId,{currentStage,status});
    return getInspectionById(inspectionId);
  });
}
export async function getInspectionById(id) {
  const insp=await dbService.get('SELECT * FROM inspections WHERE id = ?',[id]);
  if(!insp) return null;
  const [permit,photos]=await Promise.all([getPermitById(insp.permit_id,true),dbService.all('SELECT * FROM inspection_photos WHERE inspection_id = ?',[id])]);
  return {...insp,stage_name:INSPECTION_STAGES[insp.stage_index],permit,photos};
}
export async function getInspectionsByPermit(permitId) {
  const rows=await dbService.all('SELECT * FROM inspections WHERE permit_id = ? ORDER BY stage_index ASC',[permitId]);
  return rows.map(insp=>({...insp,stage_name:INSPECTION_STAGES[insp.stage_index]}));
}

export async function generateInspectionPrintHtml(inspectionId) {
  const stored = await getInspectionById(inspectionId);
  const insp = stored ? { ...stored } : null;
  if (!insp) throw new Error('Không tìm thấy biên bản để in');

  const snapshot = insp.snapshot_json ? JSON.parse(insp.snapshot_json) : null;
  if (!snapshot?.permit) fail('Phiếu cũ chưa có bản chụp dữ liệu; cần đối soát trước khi in', 409);
  const rawPermit = snapshot.permit;
  const p = Object.fromEntries(Object.entries(rawPermit).map(([key, value]) => [key, typeof value === 'string' ? escapeHtml(value) : value]));
  for (const key of ['notes', 'inspect_date', 'inspector_id', 'stage_name']) insp[key] = escapeHtml(insp[key]);
  const qrUrl = qrcodeService.getPermitQrUrl(rawPermit.permit_number);
  const qrSvg = qrcodeService.generateQrSvg(qrUrl, { size: 90, padding: 2 });

  return `<!DOCTYPE html>
<html lang="vi">
<head>
<meta charset="utf-8">
<title>Phiếu Kiểm tra Trật tự Xây dựng - ${p.permit_number}</title>
<style>
  body { font-family: 'Times New Roman', serif; margin: 40px; color: #111; line-height: 1.5; font-size: 15px; }
  .top-banner { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; }
  .header { text-align: center; flex: 1; margin-bottom: 10px; }
  .header h3 { margin: 0; font-size: 15px; font-weight: normal; }
  .header h2 { margin: 4px 0; font-size: 16px; font-weight: bold; }
  .line { border-top: 1px solid #111; width: 40%; margin: 6px auto 12px; }
  .qr-box { text-align: center; font-size: 11px; color: #444; margin-left: 15px; }
  .qr-box svg { display: block; margin: 0 auto 4px; border: 1px solid #ddd; }
  .title { text-align: center; font-size: 19px; font-weight: bold; margin: 15px 0 8px; text-transform: uppercase; }
  .stage { text-align: center; font-style: italic; margin-bottom: 25px; color: #333; }
  .meta-table, .data-table { width: 100%; border-collapse: collapse; margin-bottom: 20px; }
  .data-table th, .data-table td { border: 1px solid #333; padding: 8px 12px; text-align: left; }
  .data-table th { background: #f2f2f2; }
  .signatures { display: flex; justify-content: space-between; margin-top: 50px; text-align: center; }
  .sign-col { width: 45%; }
  .sign-col p { margin: 4px 0; }
  .stamp { border: 2px dashed #999; padding: 8px; text-align: center; font-size: 13px; color: #666; margin-top: 40px; }
  @media print { .no-print { display: none; } }
</style>
</head>
<body>
<div class="no-print" style="margin-bottom: 20px; text-align: right;">
  <button onclick="window.print()" style="padding: 8px 16px; background: #0066cc; color: #fff; border: none; border-radius: 4px; cursor: pointer;">In biên bản</button>
</div>

<div class="top-banner">
  <div class="header">
    <h3>ỦY BAN NHÂN DÂN PHƯỜNG THẢO NGUYÊN</h3>
    <h2>BỘ PHẬN ĐỊA CHÍNH - TRẬT TỰ XÂY DỰNG</h2>
    <div class="line"></div>
  </div>
  <div class="qr-box">
    ${qrSvg}
    <span>Mã tra cứu công trình</span>
  </div>
</div>

<div class="title">PHIẾU KIỂM TRA HIỆN TRƯỜNG CÔNG TRÌNH XÂY DỰNG</div>
<div class="stage">Mốc kiểm tra: <strong>${insp.stage_name}</strong></div>

<table class="meta-table">
  <tr><td><strong>Số GPXD:</strong> ${p.permit_number}</td><td><strong>Ngày cấp:</strong> ${p.issue_date}</td></tr>
  <tr><td><strong>Chủ đầu tư / Chủ hộ:</strong> ${p.owner_name}</td><td><strong>Loại công trình:</strong> ${p.construction_type}</td></tr>
  <tr><td colspan="2"><strong>Địa điểm xây dựng:</strong> ${p.site_address}</td></tr>
  <tr><td><strong>Ngày kiểm tra thực tế:</strong> ${insp.inspect_date}</td><td><strong>Cán bộ thực hiện:</strong> ${insp.inspector_id}</td></tr>
</table>

<h4 style="margin-top:20px; margin-bottom: 8px;">KẾT QUẢ ĐỐI CHIẾU CHỈ TIÊU THỰC TẾ SO VỚI GIẤY PHÉP:</h4>
<table class="data-table">
  <thead>
    <tr>
      <th>Chỉ tiêu kỹ thuật</th>
      <th>Theo GPXD được duyệt</th>
      <th>Ghi nhận thực tế tại hiện trường</th>
      <th>Đánh giá / Chênh lệch</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Diện tích xây dựng (m²)</td>
      <td>${p.building_area || '—'} m²</td>
      <td>${insp.measured_area != null ? insp.measured_area + ' m²' : 'Chưa đo'}</td>
      <td>${insp.measured_area && p.building_area ? (insp.measured_area - p.building_area > 0 ? '+' : '') + (insp.measured_area - p.building_area).toFixed(1) + ' m²' : '—'}</td>
    </tr>
    <tr>
      <td>Khoảng lùi công trình (m)</td>
      <td>${p.setback_text || 'Theo bản vẽ'}</td>
      <td>${insp.measured_setback != null ? insp.measured_setback + ' m' : 'Chưa đo'}</td>
      <td>${insp.measured_setback != null ? 'Đã đối chiếu mốc' : '—'}</td>
    </tr>
    <tr>
      <td>Số tầng</td>
      <td>${p.floors_text || '—'}</td>
      <td>${insp.measured_floors != null ? insp.measured_floors + ' tầng' : 'Chưa ghi nhận'}</td>
      <td>${insp.measured_floors != null ? 'Cần đối chiếu theo hồ sơ' : '—'}</td>
    </tr>
  </tbody>
</table>

<div style="margin-top: 15px;">
  <strong>Ghi nhận hiện trạng:</strong>
  <p style="margin-top: 5px; padding: 10px; background: #fdfdfd; border: 1px solid #ddd; min-height: 50px;">${insp.notes || 'Chưa ghi nhận kết luận hiện trường.'}</p>
</div>

<div class="stamp">
  BẢN MẪU THỬ NGHIỆM MỐC A · PHƯỜNG THẢO NGUYÊN (THÁNG 10/2026)<br>
  Trạng thái biên bản: <strong>${insp.status === 'approved' ? 'ĐÃ PHÊ DUYỆT CHÍNH THỨC' : 'DỰ THẢO CHỜ DUYỆT'}</strong>
</div>

<div class="signatures">
  <div class="sign-col">
    <p><strong>CHỦ HỘ / ĐẠI DIỆN THI CÔNG</strong></p>
    <p style="font-style:italic;">(Ký và ghi rõ họ tên)</p>
  </div>
  <div class="sign-col">
    <p><strong>CÁN BỘ ĐỊA CHÍNH KIỂM TRA</strong></p>
    <p style="font-style:italic;">(Ký và ghi rõ họ tên)</p>
  </div>
</div>
</body>
</html>`;
}

export default {
  INSPECTION_STAGES,
  submitInspection,
  approveInspection,
  getInspectionById,
  getInspectionsByPermit,
  generateInspectionPrintHtml
};
