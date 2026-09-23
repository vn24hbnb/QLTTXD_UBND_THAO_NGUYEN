import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import inspections from '../src/services/inspections.js';
import db from '../src/db/database.js';
import {testPermit,testInspectionData} from './helpers.js';

test('OFFLINE SYNC: Gửi lại cùng khóa nhận cùng phiếu, thay nội dung bị từ chối',async()=>{
 const permit=await testPermit();
 const payload=await testInspectionData(permit);
 const key=crypto.randomUUID();
 const first=await inspections.submitInspection(payload,'usr-inspector',key);
 const retry=await inspections.submitInspection(payload,'usr-inspector',key);
 assert.equal(first.id,retry.id);
 assert.equal((await db.get('SELECT COUNT(*) AS n FROM inspections WHERE permit_id=?',[permit.id])).n,1);
 await assert.rejects(inspections.submitInspection({...payload,measured_area:105},'usr-inspector',key), e=>e.statusCode===409);
});
