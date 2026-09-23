import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeCsvField } from '../src/services/reports.js';
import { verifyMagicBytes, saveFile } from '../src/services/storage.js';
import complaintsService, { escapeHtml } from '../src/services/complaints.js';
import permitsService from '../src/services/permits.js';
import authService from '../src/services/auth.js';
import dbService from '../src/db/database.js';

test('SECURITY: Chống tấn công CSV Formula Injection', async () => {
  // Các công thức nguy hiểm trong Excel
  assert.equal(sanitizeCsvField('=SUM(A1:A10)'), '"\'=SUM(A1:A10)"');
  assert.equal(sanitizeCsvField('+cmd|"/C calc"!A0'), '"\'+cmd|""/C calc""!A0"');
  assert.equal(sanitizeCsvField('-12345'), '"\'-12345"');
  assert.equal(sanitizeCsvField('@HYPERLINK("http://evil.com")'), '"\'@HYPERLINK(""http://evil.com"")"');

  // Giá trị an toàn bình thường
  assert.equal(sanitizeCsvField('Nhà ở riêng lẻ'), '"Nhà ở riêng lẻ"');
});

test('SECURITY: Chống tấn công XSS trong nội dung người dùng nhập', async () => {
  const evilScript = '<script>alert("XSS")</script>';
  const escaped = escapeHtml(evilScript);
  assert.equal(escaped.includes('<script>'), false);
  assert.equal(escaped, '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;');

  const comp = (await complaintsService.submitComplaint({
    title: '<img src=x onerror=alert(1)>',
    content: 'Test XSS: <script>fetch("evil.com")</script>',
    location_text: 'Tổ 1'
  }));

  assert.equal(comp.title, '<img src=x onerror=alert(1)>');
  assert.ok(!escapeHtml(comp.title).includes('<img'), 'Escape at HTML rendering boundary preserves text without executable markup');
});

test('SECURITY: Chống giả mạo định dạng tệp (MIME Spoofing)', async () => {
  // Tệp giả mạo: khai báo image/jpeg nhưng nội dung là text/script
  const fakeJpg = Buffer.from('console.log("malicious js script");');
  assert.equal(verifyMagicBytes(fakeJpg, 'image/jpeg'), false);

  // Tệp JPEG thật (Magic bytes: FF D8 FF)
  const realJpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
  assert.equal(verifyMagicBytes(realJpg, 'image/jpeg'), true);

  // Tệp PDF thật (Magic bytes: %PDF)
  const realPdf = Buffer.from('%PDF-1.4 header content');
  assert.equal(verifyMagicBytes(realPdf, 'application/pdf'), false);

  // Thử lưu tệp giả mạo phải ném ra lỗi
  await assert.rejects(async () => {
    await saveFile({
      buffer: fakeJpg,
      originalName: 'avatar.jpg',
      mimeType: 'image/jpeg'
    });
  }, /không khớp định dạng khai báo/);
});

test('SECURITY: Ghi nhận Audit Log đầy đủ cho mọi thao tác nghiệp vụ', async () => {
  const initialLogsCount = (await dbService.get('SELECT COUNT(*) as c FROM audit_logs')).c;

  (await permitsService.createPermit({
    issue_date: '2026-09-01', issuing_authority: 'Cơ quan thử nghiệm', construction_type: 'Nhà ở',
    permit_number: `AUDIT-TEST-${Date.now()}`,
    site_address: 'Tổ 6, Thảo Nguyên',
    owner_name: 'Bùi Văn Test'
  }, 'usr-admin'));

  const afterLogsCount = (await dbService.get('SELECT COUNT(*) as c FROM audit_logs')).c;
  assert.ok(afterLogsCount > initialLogsCount, 'Thao tác tạo giấy phép phải phát sinh bản ghi audit log');
});

test('SECURITY: Bảo vệ phân quyền và thu hồi phiên tức thời', async () => {
  const res = (await authService.authenticate('inspector1', 'inspect123456'));
  assert.equal(res.success, true);

  const token = res.session.token;
  assert.ok((await authService.getSession(token)));

  // Thu hồi phiên
  (await authService.deleteSession(token));
  assert.equal((await authService.getSession(token)), null, 'Phiên đã xóa không được phép tiếp tục truy cập');
});
