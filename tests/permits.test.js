import test from 'node:test';
import assert from 'node:assert/strict';
import permitsService from '../src/services/permits.js';

test('PERMITS: API Công khai tuyệt đối không để lộ dữ liệu cá nhân (PII)', async () => {
  const publicList = (await permitsService.getPublicPermits());
  assert.ok(publicList.length > 0, 'Phải có danh sách công trình công khai');

  for (const p of publicList) {
    assert.equal(p.owner_name, undefined, 'Public API không được chứa owner_name');
    assert.equal(p.owner_address, undefined, 'Public API không được chứa owner_address');
    assert.equal(p.sender_phone, undefined, 'Public API không được chứa sender_phone');
    assert.ok(p.permit_number, 'Phải có số giấy phép');
    assert.ok(p.site_address, 'Phải có địa chỉ công trình');
  }
});

test('PERMITS: API Nội bộ trả về đầy đủ thông tin pháp lý cho cán bộ', async () => {
  const internalList = (await permitsService.getInternalPermits());
  assert.ok(internalList.length > 0);
  const sample = internalList[0];
  assert.ok(sample.owner_name, 'Hồ sơ nội bộ phải có thông tin chủ hộ');
  assert.ok(sample.issuing_authority, 'Hồ sơ nội bộ phải có cơ quan cấp phép');
});

test('PERMITS: Tạo hồ sơ mới và cập nhật trạng thái có kiểm toán', async () => {
  const pNum = `TEST-999-${Date.now()}/2026/GPXD`;
  const newPermit = (await permitsService.createPermit({
    issue_date: '2026-09-01', issuing_authority: 'Cơ quan thử nghiệm', construction_type: 'Nhà ở',
    permit_number: pNum,
    site_address: 'Tổ dân phố 1, phường Thảo Nguyên',
    owner_name: 'Nguyễn Thử Nghiệm',
    building_area: 125,
    longitude: 104.689,
    latitude: 20.892
  }, 'usr-admin'));

  assert.ok(newPermit);
  assert.equal(newPermit.permit_number, pNum);
  assert.equal(newPermit.current_stage, 0);

  // Cập nhật trạng thái
  const updated = (await permitsService.updatePermitStatus(newPermit.id, {
    status: 'Đang thi công',
    version_id: newPermit.version_id
  }, 'usr-admin'));

  assert.equal(updated.status, 'Đang thi công');
  assert.equal(updated.current_stage, 0);
  assert.equal(updated.version_id, 2, 'Phiên bản hồ sơ phải tăng lên khi cập nhật');
});

test('PERMITS: Kiểm tra đầy đủ thông số kỹ thuật công khai cho người dân từ hồ sơ đã duyệt', async () => {
  const permit = (await permitsService.getPermitById('permit-018', false));
  assert.ok(permit, 'Phải tìm thấy giấy phép permit-018 công khai');

  // Các trường bắt buộc người dân được xem: Chiều cao, số tầng, diện tích, chỉ giới đường đỏ, chỉ giới xây dựng
  assert.ok(typeof permit.building_height === 'number', 'Phải có chiều cao công trình dạng số (m)');
  assert.ok(permit.building_height > 0, 'Chiều cao công trình phải lớn hơn 0');
  assert.ok(permit.confirmed_floors >= 1, 'Phải có số tầng được duyệt');
  assert.ok(permit.floors_text, 'Phải có mô tả số tầng');
  assert.ok(permit.building_area > 0, 'Phải có diện tích xây dựng tầng 1 (m²)');
  assert.ok(permit.total_floor_area > 0, 'Phải có tổng diện tích sàn (m²)');
  assert.ok(permit.red_line_setback, 'Phải có chỉ giới đường đỏ');
  assert.ok(permit.construction_boundary || permit.setback_text, 'Phải có chỉ giới xây dựng (khoảng lùi)');

  // Các trường PII bảo mật tuyệt đối không trả về cho người dân
  assert.equal(permit.owner_name, undefined, 'Người dân không được xem tên chủ hộ');
  assert.equal(permit.owner_address, undefined, 'Người dân không được xem địa chỉ cư trú chủ hộ');
  assert.equal(permit.land_use_cert, undefined, 'Người dân không được xem giấy tờ đất đai (sổ đỏ)');
});

test('PERMITS: Cán bộ được xem đầy đủ toàn văn 4 mục Giấy phép Xây dựng từ dữ liệu đã nhập', async () => {
  const permit = (await permitsService.getPermitById('permit-018', true));
  assert.ok(permit, 'Phải tìm thấy giấy phép permit-018 nội bộ');

  // Mục 1: Cấp cho
  assert.ok(permit.owner_name, 'Phải có tên chủ đầu tư / chủ hộ');
  assert.ok(permit.owner_address, 'Phải có địa chỉ cư trú chủ hộ');

  // Mục 2: Được phép xây dựng
  assert.ok(permit.construction_type, 'Phải có tên công trình');
  assert.ok(permit.design_by, 'Phải có đơn vị tư vấn thiết kế');
  assert.ok(permit.land_lot, 'Phải có vị trí lô đất, thửa, tờ bản đồ');
  assert.ok(permit.ground_elevation, 'Phải có cốt nền xây dựng công trình');
  assert.ok(permit.building_density > 0, 'Phải có mật độ xây dựng (%)');
  assert.ok(permit.land_use_ratio > 0, 'Phải có hệ số sử dụng đất');
  assert.ok(permit.red_line_setback, 'Phải có chỉ giới đường đỏ');
  assert.ok(permit.construction_boundary, 'Phải có chỉ giới xây dựng');
  assert.ok(permit.building_area > 0, 'Phải có diện tích xây dựng tầng 1');
  assert.ok(permit.total_floor_area > 0, 'Phải có tổng diện tích sàn');
  assert.ok(permit.building_height > 0, 'Phải có chiều cao công trình');
  assert.ok(permit.confirmed_floors > 0, 'Phải có số tầng');

  // Mục 3: Giấy tờ về quyền sử dụng đất
  assert.ok(permit.land_use_cert, 'Phải có thông tin GCNQSDĐ');

  // Mục 4: Thời hạn hiệu lực
  assert.ok(permit.expiration_date, 'Phải có thời hạn hiệu lực khởi công 12 tháng');
});

test('PERMITS: Không thể nhảy mốc qua cập nhật trạng thái hoặc tự bỏ lệnh dừng', async()=>{
 const permit=await permitsService.createPermit({permit_number:'LOCK-'+Date.now(),issue_date:'2026-09-01',issuing_authority:'Cơ quan thử nghiệm',construction_type:'Nhà',site_address:'Tổ thử nghiệm',owner_name:'Giả lập'},'usr-admin');
 await assert.rejects(permitsService.updatePermitStatus(permit.id,{current_stage:3,version_id:1},'usr-admin'),e=>e.statusCode===409);
 const stopped=await permitsService.updatePermitStatus(permit.id,{status:'Tạm dừng',version_id:1},'usr-admin');
 await assert.rejects(permitsService.updatePermitStatus(permit.id,{status:'Đang thi công',version_id:stopped.version_id},'usr-admin'),e=>e.statusCode===400);
 await assert.rejects(permitsService.updatePermitStatus(permit.id,{status:'Đang thi công',version_id:stopped.version_id,reason:'Đã xác minh'},'usr-inspector'),e=>e.statusCode===403);
});
