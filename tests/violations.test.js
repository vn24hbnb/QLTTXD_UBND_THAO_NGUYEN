import test from 'node:test';
import assert from 'node:assert';
import dbService from '../src/db/database.js';
import violationsService from '../src/services/violations.js';

test('VIOLATIONS: Lập biên bản vi phạm và tự động tạm dừng công trình nếu nghiêm trọng', async () => {
  const permitId = `GP-VIOL-${Date.now()}`;
  const pNum1 = `GP-VIOL-01-${Date.now()}`;
  (await dbService.run(
    `INSERT INTO permits (id, permit_number, issue_date, issuing_authority, owner_name, site_address, construction_type, status, longitude, latitude, created_at, updated_at)
     VALUES (?, ?, '2026-03-01', 'UBND', 'Vũ Quốc Cường', 'Tổ 3 Thảo Nguyên', 'Nhà ở', 'Đang thi công', 104.665, 20.842, '2026-03-01', '2026-03-01')`,
    [permitId, pNum1]
  ));

  const violation = (await violationsService.createViolation(
    {
      permit_id: permitId,
      violation_type: 'Vượt tầng / sai chiều cao công trình',
      severity: 'nghiêm_trọng',
      description: 'Cấp phép 2 tầng nhưng đang ghép cốp pha đổ sàn tầng 3',
      fine_amount: 15000000,
      remedy_deadline: '2026-10-30'
    },
    'usr-inspector'
  ));

  assert.ok(violation.id);
  assert.ok(violation.violation_code.startsWith('BBVP-2026-'));
  assert.strictEqual(violation.severity, 'nghiêm_trọng');
  assert.strictEqual(violation.remedy_deadline, '2026-10-30');

  // Công trình phải bị đổi trạng thái sang "Tạm dừng"
  const updatedPermit = (await dbService.get('SELECT status FROM permits WHERE id = ?', [permitId]));
  assert.strictEqual(updatedPermit.status, 'Tạm dừng');
});

test('VIOLATIONS: Theo dõi thời hạn, tính toán quá hạn và nghiệm thu khắc phục', async () => {
  const permitId = `GP-VIOL-REMEDY-${Date.now()}`;
  const pNum2 = `GP-VIOL-02-${Date.now()}`;
  (await dbService.run(
    `INSERT INTO permits (id, permit_number, issue_date, issuing_authority, owner_name, site_address, construction_type, status, longitude, latitude, created_at, updated_at)
     VALUES (?, ?, '2026-03-01', 'UBND', 'Đỗ Hoàng Nam', 'Tổ 4 Thảo Nguyên', 'Nhà ở', 'Tạm dừng', 104.667, 20.843, '2026-03-01', '2026-03-01')`,
    [permitId, pNum2]
  ));

  // Tạo biên bản có hạn khắc phục là ngày hôm qua (quá hạn)
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const violation = (await violationsService.createViolation(
    {
      permit_id: permitId,
      violation_type: 'Sai chỉ giới xây dựng / lấn chiếm khoảng lùi',
      severity: 'trung_bình',
      description: 'Lấn chiếm 0.5m khoảng lùi trước',
      remedy_deadline: yesterday
    },
    'usr-inspector'
  ));

  // Kiểm tra tính toán quá hạn
  const retrieved = (await violationsService.getViolationById(violation.id));
  assert.strictEqual(retrieved.isOverdue, true);
  assert.ok(retrieved.daysRemaining < 0);

  const waiting = await violationsService.updateViolationStatus(violation.id, {status:'chờ_khắc_phục',version_id:violation.version_id}, 'usr-coordinator');
  // Cập nhật khắc phục xong (nghiệm thu thực địa)
  const resolved = (await violationsService.updateViolationStatus(
    violation.id,
    {
      status: 'đã_khắc_phục', version_id: waiting.version_id,
      notes: 'Chủ nhà đã tự nguyện đập bỏ phần tường ban công lấn chiếm 0.5m'
    },
    'usr-coordinator'
  ));

  assert.strictEqual(resolved.status, 'đã_khắc_phục');

  // Trạng thái công trình được khôi phục về "Đang thi công"
  const restoredPermit = (await dbService.get('SELECT status FROM permits WHERE id = ?', [permitId]));
  assert.strictEqual(restoredPermit.status, 'Tạm dừng', 'Khắc phục không tự ý mở lại công trình');
});

test('VIOLATIONS: Xuất mẫu HTML in biên bản vi phạm đầy đủ quốc hiệu tiêu ngữ', async () => {
  const permitId = `GP-PRINT-${Date.now()}`;
  const pNum3 = `GP-PRINT-01-${Date.now()}`;
  (await dbService.run(
    `INSERT INTO permits (id, permit_number, issue_date, issuing_authority, owner_name, site_address, construction_type, status, longitude, latitude, created_at, updated_at)
     VALUES (?, ?, '2026-03-01', 'UBND', 'Nguyễn Tiến Dũng', 'Tổ 5 Thảo Nguyên', 'Nhà ở', 'Tạm dừng', 104.668, 20.844, '2026-03-01', '2026-03-01')`,
    [permitId, pNum3]
  ));


  const violation = (await violationsService.createViolation(
    {
      permit_id: permitId,
      violation_type: 'Không che chắn an toàn / vi phạm vệ sinh môi trường',
      severity: 'nhẹ',
      description: 'Thi công rơi vãi gạch vữa ra mặt đường Tổ 5',
      fine_amount: 3000000
    },
    'usr-inspector'
  ));

  const html = (await violationsService.generateViolationPrintHtml(violation.id));
  assert.ok(html.includes('CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM'));
  assert.ok(html.includes('Độc lập - Tự do - Hạnh phúc'));
  assert.ok(html.includes('BIÊN BẢN VI PHẠM HÀNH CHÍNH'));
  assert.ok(html.includes('16/2022/NĐ-CP'));
  assert.ok(html.includes(violation.violation_code));
  assert.ok(html.includes('Nguyễn Tiến Dũng'));
  assert.ok(html.includes('Tổ 5 Thảo Nguyên'));
});
