import test from 'node:test';
import assert from 'node:assert/strict';
import inspections from '../src/services/inspections.js';
import permits from '../src/services/permits.js';
import {testPermit,testInspectionData} from './helpers.js';

test('INSPECTIONS: Lập phiếu với ảnh đã lưu và số đo hiện trường',async()=>{
 const permit=await testPermit();
 const inspection=await inspections.submitInspection(await testInspectionData(permit,{measured_area:115}),'usr-inspector');
 assert.equal(inspection.status,'pending_approval');
 assert.equal(inspection.stage_name,'Trước khi đào móng');
 assert.equal(inspection.photos.length,1);
 assert.equal(inspection.measured_area,115);
});
test('INSPECTIONS: Duyệt phiếu tăng mốc và phiên bản công trình',async()=>{
 const permit=await testPermit();
 const inspection=await inspections.submitInspection(await testInspectionData(permit),'usr-inspector');
 const result=await inspections.approveInspection(inspection.id,'usr-coordinator',{version_id:permit.version_id});
 assert.equal(result.status,'approved');
 const updated=await permits.getPermitById(permit.id,true);
 assert.equal(updated.current_stage,1);
 assert.equal(updated.version_id,2);
 assert.equal(updated.status,'Đang thi công');
});
test('INSPECTIONS: Bản in chứa dữ liệu lưu và thoát ký tự HTML',async()=>{
 const permit=await testPermit();
 const inspection=await inspections.submitInspection(await testInspectionData(permit,{notes:'<script>alert(1)</script>'}),'usr-inspector');
 const html=await inspections.generateInspectionPrintHtml(inspection.id);
 assert.ok(html.includes('PHIẾU KIỂM TRA'));
 assert.ok(html.includes(permit.permit_number));
 assert.ok(!html.includes('<script>alert(1)</script>'));
 assert.ok(html.includes('&lt;script&gt;'));
});
