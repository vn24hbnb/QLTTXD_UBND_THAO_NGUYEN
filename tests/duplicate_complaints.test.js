import test from 'node:test';
import assert from 'node:assert';
import dbService from '../src/db/database.js';
import complaintsService from '../src/services/complaints.js';

test('COMPLAINTS GIS: Tự động phát hiện phản ánh lân cận theo bán kính địa lý R <= 100m', async () => {
  const now = new Date().toISOString();
  const id1 = `PA-DUP-1-${Date.now()}`;
  const id2 = `PA-DUP-2-${Date.now()}`;
  const id3 = `PA-FAR-3-${Date.now()}`;

  const lk1 = `TN-DUP1-${Date.now()}`;
  const lk2 = `TN-DUP2-${Date.now()}`;
  const lk3 = `TN-FAR3-${Date.now()}`;

  // Phản ánh 1: Tọa độ gốc tại Tổ 1 [104.66500, 20.84500]
  (await dbService.run(
    `INSERT INTO complaints (id, lookup_code, title, content, location_text, longitude, latitude, status_step, created_at, updated_at)
     VALUES (?, ?, 'Xây dựng bụi bặm', 'Công trình đổ vật liệu lấn chiếm ngõ', 'Tổ 1 Thảo Nguyên', 104.66500, 20.84500, 0, ?, ?)`,
    [id1, lk1, now, now]
  ));

  // Phản ánh 2: Cách khoảng 40 mét [104.66530, 20.84520]
  (await dbService.run(
    `INSERT INTO complaints (id, lookup_code, title, content, location_text, longitude, latitude, status_step, created_at, updated_at)
     VALUES (?, ?, 'Lấn chiếm lối đi', 'Xe chở cát chắn đường đi lại', 'Ngõ 2, Tổ 1 Thảo Nguyên', 104.66530, 20.84520, 0, ?, ?)`,
    [id2, lk2, now, now]
  ));

  // Phản ánh 3: Cách hơn 1.5 km [104.68000, 20.85500]
  (await dbService.run(
    `INSERT INTO complaints (id, lookup_code, title, content, location_text, longitude, latitude, status_step, created_at, updated_at)
     VALUES (?, ?, 'Công trình không che chắn', 'Không che chắn lưới an toàn', 'Tổ 7 Thảo Nguyên', 104.68000, 20.85500, 0, ?, ?)`,
    [id3, lk3, now, now]
  ));


  // Tìm các phản ánh trùng lặp với Phản ánh 1 trong bán kính 100m
  const duplicates = (await complaintsService.findDuplicateComplaints(id1, 100));

  // Phải phát hiện id2 là trùng lặp, không được có id3
  assert.ok(duplicates.some(d => d.id === id2), 'Phải phát hiện phản ánh id2 lân cận');
  assert.ok(!duplicates.some(d => d.id === id3), 'Không được phát hiện phản ánh id3 cách xa 1.5km');

  const dup2 = duplicates.find(d => d.id === id2);
  assert.ok(dup2.distanceMeters <= 100, 'Khoảng cách phải nhỏ hơn hoặc bằng 100m');
  assert.ok(dup2.similarityReason.includes('Khoảng cách địa lý gần'));
});

test('COMPLAINTS GIS: Gộp phản ánh trùng lặp bảo toàn lịch sử và phản hồi người dân', async () => {
  const now = new Date().toISOString();
  const targetId = `PA-TARGET-${Date.now()}`;
  const sourceId1 = `PA-SRC1-${Date.now()}`;
  const sourceId2 = `PA-SRC2-${Date.now()}`;

  const tgtCode = `TN-TGT-${Date.now()}`;
  const srcCode1 = `TN-SRC1-${Date.now()}`;
  const srcCode2 = `TN-SRC2-${Date.now()}`;

  (await dbService.run(
    `INSERT INTO complaints (id, lookup_code, title, content, location_text, longitude, latitude, status_step, created_at, updated_at)
     VALUES (?, ?, 'Phản ánh gốc', 'Móng nhà vi phạm khoảng lùi', 'Tổ 2 Thảo Nguyên', 104.666, 20.846, 1, ?, ?)`,
    [targetId, tgtCode, now, now]
  ));

  (await dbService.run(
    `INSERT INTO complaints (id, lookup_code, title, content, location_text, longitude, latitude, status_step, created_at, updated_at)
     VALUES (?, ?, 'Phản ánh phụ 1', 'Đào móng gây nứt tường nhà bên cạnh', 'Tổ 2 Thảo Nguyên', 104.666, 20.846, 0, ?, ?)`,
    [sourceId1, srcCode1, now, now]
  ));

  (await dbService.run(
    `INSERT INTO complaints (id, lookup_code, title, content, location_text, longitude, latitude, status_step, created_at, updated_at)
     VALUES (?, ?, 'Phản ánh phụ 2', 'Bụi bặm thi công móng', 'Tổ 2 Thảo Nguyên', 104.666, 20.846, 0, ?, ?)`,
    [sourceId2, srcCode2, now, now]
  ));


  // Thực hiện gộp sourceId1 và sourceId2 vào targetId
  const mergeResult = (await complaintsService.mergeComplaints(
    targetId,
    [sourceId1, sourceId2],
    'Trùng công trình đang đào móng tại Tổ 2',
    'usr-coordinator', {version_id:1,source_versions:{[sourceId1]:1,[sourceId2]:1}}
  ));

  assert.strictEqual(mergeResult.success, true);
  assert.strictEqual(mergeResult.mergedCount, 2);

  // Kiểm tra phản ánh chính (target)
  const updatedTarget = (await complaintsService.getComplaintById(targetId));
  assert.equal(updatedTarget.version_id, 2);
  assert.ok(!JSON.stringify(updatedTarget.investigation_notes).includes(srcCode2));

  // Kiểm tra phản ánh nguồn (sources) đã được gắn master_complaint_id và đóng phản hồi
  const updatedSource1 = (await complaintsService.getComplaintById(sourceId1));
  assert.strictEqual(updatedSource1.master_complaint_id, targetId);
  assert.strictEqual(updatedSource1.status_step, 0); // Đã phản hồi / đóng gộp
  assert.ok(!String(updatedSource1.official_reply).includes(tgtCode));

  // Tra cứu công khai phản ánh nguồn vẫn hiển thị thông tin trả lời chỉ dẫn
  const publicLookup = (await complaintsService.lookupComplaint(updatedSource1.lookup_code));
  assert.ok(!JSON.stringify(publicLookup).includes(tgtCode));
  assert.ok(!JSON.stringify(publicLookup).includes(targetId));

});
