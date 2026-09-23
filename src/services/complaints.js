import crypto from 'node:crypto';
import dbService from '../db/database.js';
import gisService from './gis.js';
import { text, number, coordinates, expectedVersion, requireStaff, audit, idempotent, fail } from './validation.js';

export const COMPLAINT_STEPS=['Mới gửi','Đã tiếp nhận','Đã phân công','Đang kiểm tra','Chờ duyệt','Đã phản hồi'];
export function generateLookupCode() { return `TN-DEMO-${crypto.randomBytes(16).toString('hex').toUpperCase()}`; }
export function escapeHtml(str) {
  return String(str??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function label(c) { return c ? {...c,status_label:COMPLAINT_STEPS[c.status_step]??'Không xác định'} : null; }
function redactContact(c) {
  const {lookup_code,sender_phone,sender_email,idempotency_key,...allowed}=c;
  return allowed;
}
async function rawComplaint(id) { return label(await dbService.get('SELECT * FROM complaints WHERE id = ?',[id])); }
export async function submitComplaint(data,idempotencyKey=null,userId='anonymous') {
  const title=text(data.title,'tiêu đề',{max:500})||'Phản ánh trật tự xây dựng';
  const content=text(data.content,'nội dung phản ánh',{required:true,max:10000});
  const location=text(data.location_text,'địa chỉ phản ánh',{required:true,max:2000});
  const coords=coordinates(data.longitude,data.latitude);
  const isAnonymous=data.is_anonymous!==false && data.is_anonymous!==0;
  const phone=isAnonymous?null:text(data.sender_phone,'số điện thoại',{max:30});
  const email=isAnonymous?null:text(data.sender_email,'email',{max:254});
  if(phone&&!/^[+0-9(). -]{7,30}$/.test(phone)) fail('Số điện thoại không hợp lệ');
  if(email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail('Email không hợp lệ');
  const permitId=text(data.permit_id,'mã công trình',{max:200});
  return idempotent('/api/public/complaints',userId,idempotencyKey,data,async db=>{
    if(permitId&&!await db.get('SELECT id FROM permits WHERE id = ? AND is_public = 1',[permitId])) fail('Không tìm thấy công trình công khai');
    const id=`PA-${crypto.randomUUID()}`;
    const lookupCode=generateLookupCode();
    const now=new Date().toISOString();
    await db.run('INSERT INTO complaints (id,lookup_code,title,content,location_text,permit_id,longitude,latitude,is_anonymous,sender_phone,sender_email,status_step,created_at,updated_at,version_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,0,?,?,1)',[id,lookupCode,title,content,location,permitId,coords.longitude,coords.latitude,isAnonymous?1:0,phone,email,now,now]);
    await audit(db,userId,'SUBMIT_COMPLAINT','complaints',id,{isAnonymous});
    return {id,lookup_code:lookupCode,status:'Mới gửi',status_step:0,title,location_text:location,created_at:now};
  });
}
export async function lookupComplaint(lookupCode) {
  const code=text(lookupCode,'mã tra cứu',{required:true,max:100});
  const complaint=await dbService.get(`SELECT id,lookup_code,title,content,location_text,status_step,
    CASE WHEN status_step = 5 AND reply_approved_at IS NOT NULL THEN official_reply ELSE NULL END AS official_reply,
    created_at,updated_at FROM complaints WHERE lookup_code = ?`,[code.toUpperCase()]);
  return label(complaint);
}
export async function getInternalComplaints({statusStep=null,limit=100,offset=0}={}) {
  let sql='SELECT * FROM complaints WHERE 1=1';
  const params=[];
  if(statusStep!==null){sql+=' AND status_step = ?';params.push(number(statusStep,'bước xử lý',{integer:true,max:5,required:true}));}
  sql+=' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(number(limit,'giới hạn',{integer:true,min:1,max:1000,required:true}),number(offset,'vị trí',{integer:true,required:true}));
  return (await dbService.all(sql,params)).map(label);
}
export async function getComplaintById(id) { return rawComplaint(id); }
export async function updateComplaintStep(id,{step,notes,reply,assigned_to,approved_read,version_id},userId) {
  const user=await requireStaff(userId);
  return dbService.transaction(async db=>{
    const complaint=await rawComplaint(id);
    if(!complaint) fail('Không tìm thấy phản ánh',404);
    expectedVersion(version_id,complaint.version_id);
    if(complaint.master_complaint_id) fail('Phản ánh đã được gộp; xử lý tại hồ sơ chính',409);
    const nextStep=number(step,'bước xử lý',{integer:true,max:5,required:true});
    if(nextStep!==complaint.status_step+1) fail('Phải thực hiện đúng trình tự xử lý phản ánh',409);
    if([1,2,5].includes(nextStep)&&!['admin','coordinator'].includes(user.role)) fail('Bước này cần quyền tiếp nhận hoặc phê duyệt',403);
    if(user.role==='inspector'&&complaint.assigned_to!==userId) fail('Phản ánh chưa được phân công cho bạn',403);
    const assignedTo=text(assigned_to,'cán bộ được phân công',{max:200})||complaint.assigned_to;
    if(nextStep===2){ if(!assignedTo) fail('Phải chọn cán bộ phụ trách'); await requireStaff(assignedTo); }
    const investigation=text(notes,'kết quả xác minh')??complaint.investigation_notes;
    const officialReply=text(reply,'nội dung phản hồi')??complaint.official_reply;
    if(nextStep===4&&!investigation) fail('Phải nhập kết quả xác minh trước khi gửi duyệt');
    if(nextStep===5&&(!officialReply||approved_read!==true)) fail('Phải đọc và xác nhận nội dung phản hồi trước khi duyệt');
    const now=new Date().toISOString();
    const result=await db.run('UPDATE complaints SET status_step = ?,investigation_notes = ?,official_reply = ?,assigned_to = ?,reply_approved_at = ?,reply_approved_by = ?,version_id = version_id + 1,updated_at = ? WHERE id = ? AND version_id = ?',[nextStep,investigation,officialReply,assignedTo,nextStep===5?now:null,nextStep===5?userId:null,now,id,version_id]);
    if(Number(result.changes)!==1) fail('Phản ánh đã thay đổi',409,'VERSION_CONFLICT');
    if(nextStep===5) {
      const sources=await db.all('SELECT id FROM complaints WHERE master_complaint_id = ?',[id]);
      for(const source of sources) {
        await db.run('UPDATE complaints SET status_step = 5,official_reply = ?,reply_approved_at = ?,reply_approved_by = ?,version_id = version_id + 1,updated_at = ? WHERE id = ?',[officialReply,now,userId,now,source.id]);
        await audit(db,userId,'APPROVE_MERGED_COMPLAINT_REPLY','complaints',source.id,{masterId:id});
      }
    }
    await audit(db,userId,'UPDATE_COMPLAINT_STEP','complaints',id,{oldStep:complaint.status_step,newStep:nextStep});
    return rawComplaint(id);
  });
}
export async function reopenComplaint(id,userId,{version_id}={}) {
  await requireStaff(userId,['admin','coordinator']);
  return dbService.transaction(async db=>{
    const complaint=await rawComplaint(id);
    if(!complaint) fail('Không tìm thấy phản ánh',404);
    expectedVersion(version_id,complaint.version_id);
    if(complaint.status_step!==5||complaint.master_complaint_id) fail('Chỉ mở lại phản ánh đã phản hồi và chưa gộp',409);
    const result=await db.run('UPDATE complaints SET status_step = 3,reply_approved_at = NULL,reply_approved_by = NULL,version_id = version_id + 1,updated_at = ? WHERE id = ? AND version_id = ?',[new Date().toISOString(),id,version_id]);
    if(Number(result.changes)!==1) fail('Phản ánh đã thay đổi',409,'VERSION_CONFLICT');
    await db.run('UPDATE complaints SET status_step = 3,reply_approved_at = NULL,reply_approved_by = NULL,version_id = version_id + 1,updated_at = ? WHERE master_complaint_id = ?',[new Date().toISOString(),id]);
    await audit(db,userId,'REOPEN_COMPLAINT','complaints',id,{oldStep:5,newStep:3});
    return rawComplaint(id);
  });
}

export async function findDuplicateComplaints(complaintId, radiusMeters = 100) {
  const current = await rawComplaint(complaintId);
  if (!current) throw new Error(`Không tìm thấy phản ánh ${complaintId}`);

  // Lấy các phản ánh khác chưa bị gộp và không phải chính nó
  const candidates = await dbService.all(
    `SELECT * FROM complaints
     WHERE id != ? AND (master_complaint_id IS NULL OR master_complaint_id = '')
     ORDER BY created_at DESC`,
    [complaintId]
  );

  const duplicates = [];

  for (const item of candidates) {
    let isDuplicate = false;
    let distance = null;
    let reasons = [];

    // 1. Kiểm tra cùng permit_id (nếu có)
    if (current.permit_id && item.permit_id && current.permit_id === item.permit_id) {
      isDuplicate = true;
      reasons.push('Cùng số giấy phép / hồ sơ công trình');
    }

    // 2. Kiểm tra khoảng cách GIS nếu cả 2 đều có tọa độ hợp lệ
    if (
      current.longitude && current.latitude &&
      item.longitude && item.latitude &&
      (current.longitude !== 0 || current.latitude !== 0) &&
      (item.longitude !== 0 || item.latitude !== 0)
    ) {
      distance = gisService.calculateDistance(
        [current.longitude, current.latitude],
        [item.longitude, item.latitude]
      );

      if (distance <= radiusMeters) {
        isDuplicate = true;
        reasons.push(`Khoảng cách địa lý gần: ${Math.round(distance)}m (ngưỡng ≤ ${radiusMeters}m)`);
      }
    }

    // 3. Kiểm tra địa chỉ chuỗi tương đồng
    if (!isDuplicate && current.location_text && item.location_text) {
      const loc1 = current.location_text.toLowerCase().trim();
      const loc2 = item.location_text.toLowerCase().trim();
      if (loc1.length > 5 && (loc1 === loc2 || loc1.includes(loc2) || loc2.includes(loc1))) {
        isDuplicate = true;
        reasons.push('Trùng khớp địa chỉ phản ánh');
      }
    }

    if (isDuplicate) {
      duplicates.push({
        ...redactContact(item),
        status_label: COMPLAINT_STEPS[item.status_step] || 'Không xác định',
        distanceMeters: distance != null ? Math.round(distance) : null,
        similarityReason: reasons.join('; ')
      });
    }
  }

  return duplicates;
}


export async function mergeComplaints(targetId,sourceIds,reason,userId,{version_id,source_versions={}}={}) {
  await requireStaff(userId,['admin','coordinator']);
  if(!Array.isArray(sourceIds)||!sourceIds.length||sourceIds.length>100||new Set(sourceIds).size!==sourceIds.length||sourceIds.includes(targetId)) fail('Danh sách phản ánh gộp không hợp lệ');
  const cleanReason=text(reason,'lý do gộp',{required:true,max:2000});
  return dbService.transaction(async db=>{
    const target=await rawComplaint(targetId);
    if(!target) fail('Không tìm thấy phản ánh chính',404);
    expectedVersion(version_id,target.version_id);
    if(target.master_complaint_id||target.status_step===5) fail('Chỉ gộp vào hồ sơ chính đang xử lý',409);
    const now=new Date().toISOString();
    for(const id of sourceIds){
      const source=await rawComplaint(id);
      if(!source) fail('Không tìm thấy phản ánh cần gộp',404);
      if(source.master_complaint_id||source.status_step===5) fail('Phản ánh nguồn đã gộp hoặc đã phản hồi',409);
      if(await db.get('SELECT id FROM complaints WHERE master_complaint_id = ?',[id])) fail('Không gộp hồ sơ đang có phản ánh phụ',409);
      // Compare the version read in this transaction even when the client has no source snapshot.
      if(source_versions[id]!=null) expectedVersion(source_versions[id],source.version_id);
      const changed=await db.run('UPDATE complaints SET master_complaint_id = ?,merged_at = ?,merged_reason = ?,version_id = version_id + 1,updated_at = ? WHERE id = ? AND version_id = ?',[targetId,now,cleanReason,now,id,source.version_id]);
      if(Number(changed.changes)!==1) fail('Phản ánh nguồn đã thay đổi',409,'VERSION_CONFLICT');
      await audit(db,userId,'MERGE_COMPLAINT_SOURCE','complaints',id,{targetId,reason:cleanReason});
    }
    const changed=await db.run('UPDATE complaints SET version_id = version_id + 1,updated_at = ? WHERE id = ? AND version_id = ?',[now,targetId,version_id]);
    if(Number(changed.changes)!==1) fail('Phản ánh chính đã thay đổi',409,'VERSION_CONFLICT');
    await audit(db,userId,'MERGE_COMPLAINT_TARGET','complaints',targetId,{sourceIds,reason:cleanReason});
    return {success:true,targetId,mergedCount:sourceIds.length};
  });
}
export default {COMPLAINT_STEPS,generateLookupCode,submitComplaint,lookupComplaint,getInternalComplaints,getComplaintById,updateComplaintStep,reopenComplaint,findDuplicateComplaints,mergeComplaints};
