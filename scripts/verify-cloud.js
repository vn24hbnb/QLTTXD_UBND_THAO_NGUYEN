import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import sharp from 'sharp';
import {createClient} from '@supabase/supabase-js';
import db,{closeDatabase} from '../src/db/database.js';
import {hashPassword} from '../src/services/auth.js';
import permits from '../src/services/permits.js';
import inspections from '../src/services/inspections.js';
import complaints from '../src/services/complaints.js';
import storage from '../src/services/storage.js';
if(db.dialect!=='postgres')throw new Error('Cần DATABASE_URL của môi trường kiểm tra');
const runId=crypto.randomUUID();const uploaded=[];const rollback=new Error('verification rollback');
const client=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false}});
try{
 await db.transaction(async()=>{
  const officer='verify-'+runId;
  await db.run('INSERT INTO users(id,username,password_hash,full_name,role,created_at) VALUES(?,?,?,?,?,?)',[officer,officer,hashPassword(crypto.randomBytes(32).toString('hex')),'Tài khoản kiểm tra tạm','coordinator',new Date().toISOString()]);
  const permit=await permits.createPermit({permit_number:'VERIFY-'+runId,issue_date:'2026-09-22',issuing_authority:'Dữ liệu kiểm thử',construction_type:'Mẫu',site_address:'Mẫu không có giá trị hồ sơ',owner_name:'Giả lập',longitude:104.688,latitude:20.893},officer);
  assert.equal(permit.is_public,0);
  assert.equal(await permits.getPermitById(permit.id,false),undefined);
  const buffer=await sharp({create:{width:8,height:8,channels:3,background:'#336699'}}).png().toBuffer();
  const photo=await storage.saveFile({buffer,originalName:'verification.png',mimeType:'image/png',ownerId:officer});uploaded.push(photo.fileName);
  assert.ok((await storage.getFile(photo.fileName,{id:officer,role:'coordinator'})).buffer.length);
  const payload={permit_id:permit.id,stage_index:0,inspect_date:'2026-09-22',measured_area:100,measured_setback:3,measured_setback_rear:2,measured_floors:1,photos:[photo]};
  const key=crypto.randomUUID();const inspection=await inspections.submitInspection(payload,officer,key);
  assert.equal((await inspections.submitInspection(payload,officer,key)).id,inspection.id);
  await inspections.approveInspection(inspection.id,officer,{version_id:permit.version_id});
  const current=await permits.getPermitById(permit.id,true);assert.equal(current.current_stage,1);
  await permits.publishPermit(permit.id,{version_id:current.version_id,is_public:true},officer);
  assert.equal((await permits.getPermitById(permit.id,false)).owner_name,undefined);
  const complaint=await complaints.submitComplaint({content:'Phản ánh kiểm thử tạm',location_text:'Mẫu'},crypto.randomUUID());
  assert.equal((await complaints.lookupComplaint(complaint.lookup_code)).id,complaint.id);
  assert.ok((await db.get('SELECT extensions.ST_SRID(location) AS srid FROM permits WHERE id=?',[permit.id])).srid===4326);
  throw rollback;
 });
}catch(error){if(error!==rollback){console.error({result:'failed',name:error.name,code:error.code,message:error.message});process.exitCode=1;}}
finally{
 if(uploaded.length){const {error}=await client.storage.from(process.env.SUPABASE_STORAGE_BUCKET||'qlttxd-private').remove(uploaded);if(error){console.error('Không dọn được ảnh kiểm thử');process.exitCode=1;}}
 await closeDatabase();
}
if(!process.exitCode)console.log('PASS: PostgreSQL/PostGIS, giao dịch, hồ sơ riêng tư, ảnh riêng tư, chống gửi lặp, duyệt mốc và tra cứu phản ánh; toàn bộ dữ liệu kiểm thử đã rollback.');
