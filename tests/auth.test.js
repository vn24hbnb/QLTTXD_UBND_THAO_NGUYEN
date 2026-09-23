import test from 'node:test';
import assert from 'node:assert/strict';
import authService, { hashPassword, verifyTotp } from '../src/services/auth.js';

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

test('AUTH: Kiểm tra TOTP hai bước (RFC 6238)', async () => {
  const secret = 'JBSWY3DPEHPK3PXP';
  // Token rỗng hoặc sai định dạng
  assert.equal(verifyTotp(secret, '000000'), false);
  assert.equal(verifyTotp(secret, ''), false);
  assert.equal(verifyTotp(secret, null), false);
});
