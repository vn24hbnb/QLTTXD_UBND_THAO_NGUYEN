import test from 'node:test';
import assert from 'node:assert/strict';
import authService, { hashPassword, verifyTotp } from '../src/services/auth.js';
import dbService from '../src/db/database.js';
import { seed } from '../src/db/seed.js';

test('AUTH: Băm mật khẩu và kiểm tra nhất quán', async () => {
  const hash1 = hashPassword('testpass123');
  const hash2 = hashPassword('testpass123');
  const hash3 = hashPassword('otherpass');

  assert.notEqual(hash1, hash2, 'Mỗi mật khẩu phải có muối ngẫu nhiên riêng');
  assert.ok(hash1.startsWith('scrypt$'));
  assert.notEqual(hash1, hash3, 'Mật khẩu khác nhau phải sinh ra mã băm khác nhau');
});

test('AUTH: Xác thực đăng nhập cán bộ hợp lệ và không hợp lệ', async () => {
  // Sai mật khẩu
  const badRes = (await authService.authenticate('admin', 'wrongpass'));
  assert.equal(badRes.success, false);

  // Admin thử nghiệm cục bộ không cần TOTP.
  const adminRes = await authService.authenticate('admin', 'admin123456');
  assert.equal(adminRes.success, true);
  assert.equal(adminRes.user.role, 'admin');
  await authService.deleteSession(adminRes.session.token);

  // Đúng mật khẩu tài khoản không bật TOTP
  const inspectorRes = (await authService.authenticate('inspector1', 'inspect123456'));
  assert.equal(inspectorRes.success, true);
  assert.equal(inspectorRes.user.role, 'inspector');
  assert.ok(inspectorRes.session.token);

  // Kiểm tra phiên làm việc
  const session = (await authService.getSession(inspectorRes.session.token));
  assert.ok(session);
  assert.equal(session.username, 'inspector1');

  // Đăng xuất / Hủy phiên
  (await authService.deleteSession(inspectorRes.session.token));
  const clearedSession = (await authService.getSession(inspectorRes.session.token));
  assert.equal(clearedSession, null);
});

test('AUTH: Seed gỡ TOTP cũ chỉ khỏi tài khoản admin thử nghiệm cục bộ', () => {
  const db = dbService.getDb();
  db.prepare("UPDATE users SET totp_secret = 'JBSWY3DPEHPK3PXP' WHERE id = 'usr-admin'").run();
  seed();
  assert.equal(db.prepare("SELECT totp_secret FROM users WHERE id = 'usr-admin'").get().totp_secret, null);
});

test('AUTH: Kiểm tra TOTP hai bước (RFC 6238)', async () => {
  const secret = 'JBSWY3DPEHPK3PXP';
  // Token rỗng hoặc sai định dạng
  assert.equal(verifyTotp(secret, '000000'), false);
  assert.equal(verifyTotp(secret, ''), false);
  assert.equal(verifyTotp(secret, null), false);
});
