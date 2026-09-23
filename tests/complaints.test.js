import test from 'node:test';
import assert from 'node:assert/strict';
import complaintsService from '../src/services/complaints.js';
import dbService from '../src/db/database.js';

test('COMPLAINTS: Tiếp nhận phản ánh, sinh mã tra cứu bảo mật', async () => {
  const comp = (await complaintsService.submitComplaint({
    title: 'Đề nghị kiểm tra lấn chiếm vỉa hè',
    content: 'Đống gạch đá xây dựng để lấn sang lòng đường ngõ 12.',
    location_text: 'Tổ 5, Thảo Nguyên',
    is_anonymous: false,
    sender_phone: '0912345678'
  }));

  assert.ok(comp.id);
  assert.ok(comp.lookup_code.startsWith('TN-DEMO-'));
  assert.equal(comp.status_step, 0);

  // Người dân tra cứu bằng mã bảo mật
  const lookup = (await complaintsService.lookupComplaint(comp.lookup_code));
  assert.ok(lookup);
  assert.equal(lookup.id, comp.id);
  assert.equal(lookup.sender_phone, undefined, 'Tra cứu công khai không được để lộ số điện thoại');
  assert.equal(lookup.status_label, 'Mới gửi');
});

test('COMPLAINTS: Chống gửi lặp với Idempotency Key', async () => {
  const testKey = `test-idemp-${Date.now()}`;
  const payload = {
    title: 'Phản ánh tiếng ồn máy cắt đá',
    content: 'Thi công gây bụi và ồn ào.',
    location_text: 'Tổ 2, Thảo Nguyên',
    is_anonymous: true
  };

  const firstCall = (await complaintsService.submitComplaint(payload, testKey));
  const secondCall = (await complaintsService.submitComplaint(payload, testKey));

  assert.equal(firstCall.id, secondCall.id, 'Cùng Idempotency-Key phải trả về cùng mã hồ sơ');
  assert.equal(firstCall.lookup_code, secondCall.lookup_code);

  // Xác minh trong DB chỉ có 1 bản ghi
  const records = (await dbService.all('SELECT * FROM complaints WHERE id = ?', [firstCall.id]));
  assert.equal(records.length, 1, 'Chỉ được tạo duy nhất 1 bản ghi trong CSDL');
});

test('COMPLAINTS: Quy trình chuyển bước và mở lại phản ánh', async () => {
  const comp = (await complaintsService.submitComplaint({
    title: 'Kiểm tra độ cao tầng tum',
    content: 'Nghi ngờ tầng tum xây vượt chiều cao cho phép.',
    location_text: 'Tổ 3, Thảo Nguyên'
  }));

  // Tiếp nhận (bước 1)
  let updated = (await complaintsService.updateComplaintStep(comp.id, { step: 1, version_id: 1 }, 'usr-coordinator'));
  assert.equal(updated.status_step, 1);

  // Phân công (bước 2)
  updated = (await complaintsService.updateComplaintStep(comp.id, { step: 2, assigned_to: 'usr-inspector', version_id: updated.version_id }, 'usr-coordinator'));
  assert.equal(updated.status_step, 2);
  assert.equal(updated.assigned_to, 'usr-inspector');

  updated = await complaintsService.updateComplaintStep(comp.id, {step:3,version_id:updated.version_id}, 'usr-inspector');
  // Ghi kết quả xác minh (bước 3 -> 4)
  updated = (await complaintsService.updateComplaintStep(comp.id, {
    step: 4, version_id: updated.version_id,
    notes: 'Đã đo đạc thực tế, tầng tum cao 2.9m đúng quy chuẩn.'
  }, 'usr-inspector'));
  assert.equal(updated.status_step, 4);

  // Duyệt phản hồi (bước 5)
  updated = (await complaintsService.updateComplaintStep(comp.id, {
    step: 5, approved_read: true, version_id: updated.version_id,
    reply: 'UBND phường đã cử cán bộ kiểm tra thực tế: Công trình thi công đúng giấy phép được duyệt.'
  }, 'usr-admin'));
  assert.equal(updated.status_step, 5);
  assert.equal(updated.status_label, 'Đã phản hồi');

  // Mở lại (reopen)
  const reopened = (await complaintsService.reopenComplaint(comp.id, 'usr-admin', {version_id:updated.version_id}));
  assert.equal(reopened.status_step, 3, 'Mở lại phải chuyển về bước đang kiểm tra (3)');
});
