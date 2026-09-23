import test from 'node:test';
import assert from 'node:assert/strict';
import reportsService from '../src/services/reports.js';
import dbService from '../src/db/database.js';

test('AUDIT LOGS: Trích xuất danh sách nhật ký kiểm toán và bộ lọc', async () => {
  // Ghi thêm log mẫu
  (await dbService.run(
    `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['usr-admin', 'EXPORT_PERMITS_CSV', 'report', 'permits_all', 'Xuất danh sách công trình', '127.0.0.1', new Date().toISOString()]
  ));

  const logs = (await reportsService.getAuditLogsReport({ limit: 50 }));
  assert.ok(logs.length > 0, 'Phải có danh sách nhật ký kiểm toán');

  const first = logs[0];
  assert.ok(first.id, 'Phải có ID nhật ký');
  assert.ok(first.action, 'Phải có hành động');
  assert.ok(first.created_at, 'Phải có thời gian');

  // Kiểm tra lọc theo action
  const filtered = (await reportsService.getAuditLogsReport({ action: 'EXPORT_PERMITS_CSV' }));
  assert.ok(filtered.length >= 1, 'Phải lọc được nhật ký theo hành động');
  assert.equal(filtered[0].action, 'EXPORT_PERMITS_CSV');
});

test('AUDIT LOGS: Xuất tệp CSV nhật ký có chống tấn công Formula Injection', async () => {
  // Ghi một hành vi có ký tự tấn công công thức (=cmd, +SUM, @formula)
  (await dbService.run(
    `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['usr-inspector', 'INSPECT_TIM_MOC', 'permit', 'GP-INJ-1', '=SUM(A1:A10)+cmd|calc', '192.168.1.100', new Date().toISOString()]
  ));

  const csv = (await reportsService.exportAuditLogsCsv());
  assert.ok(csv.startsWith('\uFEFF'), 'CSV phải có UTF-8 BOM cho Excel tiếng Việt');
  assert.ok(csv.includes('Mã nhật ký') && csv.includes('Hành động') && csv.includes('Đối tượng'), 'Phải chứa các cột tiêu đề chuẩn');
  assert.ok(csv.includes('INSPECT_TIM_MOC'), 'Phải chứa bản ghi nhật ký');

  // Kiểm tra trường nguy hiểm đã được bọc thoát hiểm an toàn
  assert.ok(csv.includes("'=SUM(A1:A10)+cmd|calc"), 'Trường =SUM phải được escape an toàn bằng dấu nháy đơn');
});

test('AUDIT LOGS: Bảo vệ dữ liệu cá nhân theo Nghị định 13/2023 và Luật 91/2025', async () => {
  const logs = (await reportsService.getAuditLogsReport({ limit: 100 }));
  for (const log of logs) {
    const details = log.details || '';
    assert.ok(!details.includes('password_hash'), 'Nhật ký kiểm toán không được ghi băm mật khẩu');
    assert.ok(!details.includes('totp_secret'), 'Nhật ký kiểm toán không được để lộ khóa TOTP');
  }
});
