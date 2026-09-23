import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

const isolated = await fs.mkdtemp(path.join(os.tmpdir(), 'qlttxd-integrity-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(isolated, 'test.db');
process.env.UPLOADS_DIR = path.join(isolated, 'uploads');
delete process.env.DATABASE_URL;
delete process.env.SUPABASE_URL;
const { default: db, closeDatabase } = await import('../src/db/database.js');
const { default: permits } = await import('../src/services/permits.js');
const { default: inspections } = await import('../src/services/inspections.js');
const { default: complaints } = await import('../src/services/complaints.js');
const { default: batches } = await import('../src/services/batch_import.js');
const { default: violations } = await import('../src/services/violations.js');
const { default: storage } = await import('../src/services/storage.js');
const { default: reports } = await import('../src/services/reports.js');
let photo;

before(async () => {
  await db.ready();
  for (const role of ['admin', 'coordinator', 'inspector', 'citizen']) {
    await db.run('INSERT INTO users (id,username,password_hash,full_name,role,is_active,created_at) VALUES (?,?,?,?,?,1,?)', [`integrity-${role}`,`integrity-${role}`,'unused',`Kiểm thử ${role}`,role,new Date().toISOString()]);
  }
  const buffer = await sharp({create:{width:2,height:2,channels:3,background:'#26788a'}}).png().toBuffer();
  photo = await storage.saveFile({buffer,originalName:'test.png',mimeType:'image/png',ownerId:'integrity-inspector'});
});
after(async () => {
  await closeDatabase();
  await fs.rm(isolated,{recursive:true,force:true});
});
function permitPayload(extra={}) {
  return {permit_number:`REG-${crypto.randomUUID()}`,issue_date:'2026-09-01',issuing_authority:'Cơ quan thử nghiệm',owner_name:'Chủ hộ thử nghiệm',construction_type:'Nhà ở riêng lẻ',site_address:'Tổ 1, dữ liệu thử nghiệm',longitude:104.689,latitude:20.892,...extra};
}
async function createPermit(extra={}) { return permits.createPermit(permitPayload(extra),'integrity-admin'); }
function inspectionPayload(permit,stage=0,extra={}) { return {permit_id:permit.id,stage_index:stage,inspect_date:'2026-09-20',photos:[photo],...extra}; }
async function createComplaint(extra={}) { return complaints.submitComplaint({title:'Kiểm thử',content:'Nội dung kiểm thử',location_text:'Tổ 1, địa điểm thử nghiệm',...extra},crypto.randomUUID()); }
async function advanceComplaint(id,step,extra={}) {
  const current=await complaints.getComplaintById(id);
  return complaints.updateComplaintStep(id,{step,version_id:current.version_id,...extra},'integrity-admin');
}

test('INTEGRITY: giấy phép riêng tư, không tự bịa số liệu; công bố có kiểm tra phiên bản',async()=>{
  const permit=await createPermit({building_height:8.5,land_lot:'Thửa mẫu'});
  for(const field of ['building_area','confirmed_floors','floors_text','setback_text']) assert.equal(permit[field],null);
  assert.equal(permit.building_height,8.5);
  assert.equal(permit.land_lot,'Thửa mẫu');
  assert.equal(permit.is_public,0);
  assert.equal(await permits.getPermitById(permit.id),undefined);
  const published=await permits.publishPermit(permit.id,{version_id:1,is_public:true},'integrity-admin');
  assert.equal(published.version_id,2);
  assert.ok(await permits.getPermitById(permit.id));
  await assert.rejects(permits.publishPermit(permit.id,{version_id:1,is_public:false},'integrity-admin'),{statusCode:409});
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM permit_history WHERE permit_id = ?',[permit.id])).n,1);
  await assert.rejects(permits.createPermit({permit_number:'INCOMPLETE',site_address:'Tổ 1'},'integrity-admin'),/ngày cấp/);
});

test('INTEGRITY: 1–5 ảnh thật; không chấp nhận ảnh giả, số âm hoặc mốc phân số',async()=>{
  const permit=await createPermit();
  for(const extra of [{photos:[]},{photos:[{fileName:'fake.png'}]},{stage_index:0.5},{measured_area:-1},{measured_floors:1.5}]) {
    await assert.rejects(inspections.submitInspection(inspectionPayload(permit,0,extra),'integrity-inspector'));
  }
  const inspection=await inspections.submitInspection(inspectionPayload(permit,0,{measured_area:'',measured_setback:' '}),'integrity-inspector');
  assert.equal(inspection.measured_area,null);
  assert.equal(inspection.measured_setback,null);
  assert.equal(inspection.photos[0].sha256_hash,photo.sha256);
});

test('INTEGRITY: gửi lặp đồng thời phiếu kiểm tra chỉ tạo một phiếu, khác nội dung trả 409',async()=>{
  const permit=await createPermit();
  const body=inspectionPayload(permit);
  const key=crypto.randomUUID();
  const [first,retry]=await Promise.all([inspections.submitInspection(body,'integrity-inspector',key),inspections.submitInspection(body,'integrity-inspector',key)]);
  assert.equal(first.id,retry.id);
  assert.equal((await db.get('SELECT COUNT(*) AS n FROM inspections WHERE permit_id = ?',[permit.id])).n,1);
  await assert.rejects(inspections.submitInspection({...body,notes:'Thay đổi'},'integrity-inspector',key),{statusCode:409});
});

test('INTEGRITY: phải duyệt đủ bốn mốc; duyệt không bỏ lệnh tạm dừng, không duyệt lại',async()=>{
  const permit=await createPermit();
  const last=await inspections.submitInspection(inspectionPayload(permit,3),'integrity-inspector');
  await assert.rejects(inspections.approveInspection(last.id,'integrity-admin',{version_id:1}),{statusCode:409});
  for(let stage=0;stage<3;stage++) {
    const inspection=await inspections.submitInspection(inspectionPayload(permit,stage),'integrity-inspector');
    const current=await permits.getPermitById(permit.id,true);
    await inspections.approveInspection(inspection.id,'integrity-admin',{version_id:current.version_id});
  }
  await violations.createViolation({permit_id:permit.id,violation_type:'Khác',description:'Lệnh tạm dừng thử nghiệm',severity:'nghiêm_trọng'},'integrity-inspector');
  let current=await permits.getPermitById(permit.id,true);
  const approved=await inspections.approveInspection(last.id,'integrity-admin',{version_id:current.version_id});
  assert.equal(approved.permit.current_stage,4);
  assert.equal(approved.permit.status,'Tạm dừng');
  current=await permits.getPermitById(permit.id,true);
  await assert.rejects(inspections.approveInspection(last.id,'integrity-admin',{version_id:current.version_id}),{statusCode:409});
});

test('INTEGRITY: bản in thoát HTML và giữ dữ liệu giấy phép tại lúc lập',async()=>{
  const permit=await createPermit({owner_name:'Tên gốc <script>bad()</script>',building_area:100});
  const inspection=await inspections.submitInspection(inspectionPayload(permit,0,{notes:'<img src=x onerror="bad()">'}),'integrity-inspector');
  await db.run('UPDATE permits SET owner_name = ?,building_area = ? WHERE id = ?',['Tên mới',200,permit.id]);
  const html=await inspections.generateInspectionPrintHtml(inspection.id);
  assert.ok(html.includes('Tên gốc &lt;script&gt;'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(!html.includes('Tên mới'));
  assert.ok(html.includes('100 m²'));
});

test('INTEGRITY: commit CSV tự xác thực, giữ tên và địa chỉ chủ hộ đúng cột, rollback cả lô',async()=>{
  const body=permitPayload();
  await assert.rejects(batches.commitBatch([{...body,issue_date:'2026-02-30'}],'integrity-admin'));
  await assert.rejects(batches.commitBatch([{...body,building_area:-100}],'integrity-admin'));
  await assert.rejects(batches.commitBatch([{...body,longitude:999}],'integrity-admin'));
  const csv='Số giấy phép,Ngày cấp,Cơ quan cấp,Chủ hộ,Địa chỉ chủ hộ,Địa điểm xây dựng,Loại công trình,Kinh độ,Vĩ độ\nCSV-REG,01/09/2026,Cơ quan thử nghiệm,Tên đúng,Nơi cư trú,Tổ 1,Nhà ở,104.689,20.892';
  const preview=await batches.previewBatch(csv);
  assert.equal(preview.validCount,1);
  assert.equal(preview.previewRows[0].data.owner_name,'Tên đúng');
  assert.equal(preview.previewRows[0].data.owner_address,'Nơi cư trú');
  const result=await batches.commitBatch(preview.previewRows,'integrity-admin');
  assert.equal((await permits.getPermitById(result.permits[0].id,true)).is_public,0);
  const candidate=permitPayload();
  await assert.rejects(batches.commitBatch([candidate,{...body,permit_number:'CSV-REG'}],'integrity-admin'));
  assert.equal(await db.get('SELECT id FROM permits WHERE permit_number = ?',[candidate.permit_number]),undefined);
});

test('INTEGRITY: phản ánh chỉ lộ phản hồi đã duyệt; bước xử lý và mở lại cần phiên bản đúng',async()=>{
  const complaint=await createComplaint();
  await assert.rejects(complaints.updateComplaintStep(complaint.id,{step:5,version_id:1,reply:'Bỏ bước',approved_read:true},'integrity-admin'),{statusCode:409});
  await advanceComplaint(complaint.id,1,{reply:'Nội dung dự thảo chưa duyệt'});
  assert.equal((await complaints.lookupComplaint(complaint.lookup_code)).official_reply,null);
  await advanceComplaint(complaint.id,2,{assigned_to:'integrity-inspector'});
  await advanceComplaint(complaint.id,3);
  await advanceComplaint(complaint.id,4,{notes:'Kết quả xác minh thử nghiệm'});
  const current=await complaints.getComplaintById(complaint.id);
  await assert.rejects(complaints.updateComplaintStep(complaint.id,{step:5,version_id:current.version_id,reply:'Chưa xác nhận đọc'},'integrity-admin'));
  const approved=await advanceComplaint(complaint.id,5,{reply:'Kết quả đã phê duyệt',approved_read:true});
  assert.equal((await complaints.lookupComplaint(complaint.lookup_code)).official_reply,'Kết quả đã phê duyệt');
  await complaints.reopenComplaint(complaint.id,'integrity-admin',{version_id:approved.version_id});
  assert.equal((await complaints.lookupComplaint(complaint.lookup_code)).official_reply,null);
});

test('INTEGRITY: gộp phản ánh không cấp mã bí mật người khác hoặc tự phê duyệt phản hồi',async()=>{
  const [target,source]=await Promise.all([createComplaint(),createComplaint()]);
  await complaints.mergeComplaints(target.id,[source.id],'Cùng địa điểm thử nghiệm','integrity-admin',{version_id:1});
  const lookup=await complaints.lookupComplaint(source.lookup_code);
  assert.equal(lookup.lookup_code,source.lookup_code);
  assert.equal(lookup.official_reply,null);
  assert.ok(!JSON.stringify(lookup).includes(target.lookup_code));
  assert.notEqual(lookup.status_step,5);
});

test('INTEGRITY: thống kê Tổ 1 nhận tiếng Việt, không nhận nhầm Tổ 10; CSV bỏ ký tự điều khiển',async()=>{
  await createPermit({site_address:'Tổ 1, địa điểm thống kê'});
  const before=(await reports.getResidentialGroupStats()).find(row=>row.groupName==='Tổ 1').totalPermits;
  assert.ok(before>0);
  await createPermit({site_address:'Tổ 10, địa điểm thống kê khác'});
  const after=(await reports.getResidentialGroupStats()).find(row=>row.groupName==='Tổ 1').totalPermits;
  assert.equal(after,before);
  assert.equal(reports.sanitizeCsvField('\u0000\t=1+1'),'"\'=1+1"');
});
