import crypto from 'node:crypto';
import sharp from 'sharp';
import storage from '../src/services/storage.js';
import permits from '../src/services/permits.js';
export async function testPermit(overrides={}) {
 return permits.createPermit({permit_number:'TEST-'+crypto.randomUUID(),issue_date:'2026-09-01',issuing_authority:'Cơ quan thử nghiệm',owner_name:'Chủ hộ giả lập',construction_type:'Nhà ở',site_address:'Địa điểm thử nghiệm',building_area:100,longitude:104.688,latitude:20.893,...overrides},'usr-admin');
}
export async function testPhoto(ownerId='usr-inspector') {
 const buffer=await sharp({create:{width:8,height:8,channels:3,background:'#608090'}}).png().toBuffer();
 return storage.saveFile({buffer,originalName:'test.png',mimeType:'image/png',ownerId});
}
export async function testInspectionData(permit,overrides={}) {
 return {permit_id:permit.id,stage_index:0,inspect_date:'2026-09-15',measured_area:100,measured_setback:3,measured_setback_rear:2,measured_floors:1,notes:'Ghi nhận thử nghiệm',photos:[await testPhoto()],...overrides};
}
