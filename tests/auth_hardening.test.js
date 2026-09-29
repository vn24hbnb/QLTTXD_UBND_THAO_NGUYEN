import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const isolated = await fs.mkdtemp(path.join(os.tmpdir(), 'qlttxd-auth-hardening-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(isolated, 'test.db');
process.env.UPLOADS_DIR = path.join(isolated, 'uploads');
delete process.env.DATABASE_URL;
delete process.env.SUPABASE_URL;
const { default: db, closeDatabase } = await import('../src/db/database.js');
const { default: auth } = await import('../src/services/auth.js');
const { createServer } = await import('../src/server.js');
let server; let base;
const cookies = {};

before(async () => {
  await db.ready();
  const now = new Date().toISOString();
  const hash = auth.hashPassword('Hardening-password-123');
  for (const role of ['admin', 'coordinator', 'inspector', 'receptionist']) {
    await db.run('INSERT INTO users (id,username,password_hash,full_name,role,is_active,created_at) VALUES (?,?,?,?,?,1,?)', [`h-${role}`, `h-${role}`, hash, role, role, now]);
    cookies[role] = (await auth.createSession(`h-${role}`)).token;
  }
  await db.run('INSERT INTO users (id,username,password_hash,full_name,role,is_active,created_at) VALUES (?,?,?,?,?,1,?)', ['h-lock', 'h-lock', hash, 'lock', 'inspector', now]);
  server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise(resolve => server.close(resolve));
  await closeDatabase();
  await fs.rm(isolated, { recursive: true, force: true });
});

const call = (route, { method = 'GET', role, body } = {}) => fetch(base + route, {
  method,
  headers: { ...(role ? { Cookie: `session_id=${cookies[role]}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...(method !== 'GET' ? { Origin: base } : {}) },
  body: body ? JSON.stringify(body) : undefined
});

test('AUTH: token phiên chỉ lưu dạng băm SHA-256 trong CSDL', async () => {
  const { token } = await auth.createSession('h-admin');
  assert.equal(await db.get('SELECT 1 AS x FROM sessions WHERE token = ?', [token]), undefined);
  assert.ok(await db.get('SELECT 1 AS x FROM sessions WHERE token = ?', [auth.hashSessionToken(token)]));
  assert.equal((await auth.getSession(token)).user_id, 'h-admin');
  await auth.deleteSession(token);
  assert.equal(await auth.getSession(token), null);
});

test('AUTH: khóa TOTP được mã hóa AES-GCM và đọc lại đúng, khóa cũ dạng rõ vẫn dùng được', () => {
  process.env.TOTP_ENCRYPTION_KEY = 'k'.repeat(40);
  const sealed = auth.sealTotpSecret('JBSWY3DPEHPK3PXP');
  assert.ok(sealed.startsWith('enc:v1:'));
  assert.ok(!sealed.includes('JBSWY3DPEHPK3PXP'));
  assert.equal(auth.openTotpSecret(sealed), 'JBSWY3DPEHPK3PXP');
  assert.equal(auth.openTotpSecret('JBSWY3DPEHPK3PXP'), 'JBSWY3DPEHPK3PXP');
  assert.equal(auth.openTotpSecret(sealed.slice(0, -2) + 'AA'), null, 'Dữ liệu bị sửa phải bị từ chối');
  process.env.TOTP_ENCRYPTION_KEY = 'x'.repeat(40);
  assert.equal(auth.openTotpSecret(sealed), null, 'Sai khóa không giải mã được');
  delete process.env.TOTP_ENCRYPTION_KEY;
  assert.equal(auth.openTotpSecret(sealed), null);
});

test('AUTH: production bắt buộc có khóa mã hóa TOTP', () => {
  const env = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try { assert.throws(() => auth.sealTotpSecret('JBSWY3DPEHPK3PXP'), /TOTP_ENCRYPTION_KEY/); }
  finally { process.env.NODE_ENV = env; }
});

test('AUTH: khóa tài khoản 15 phút sau 5 lần sai, kể cả khi sau đó nhập đúng', async () => {
  for (let i = 0; i < 5; i++) assert.equal((await auth.authenticate('h-lock', 'wrong-password')).success, false);
  const row = await db.get('SELECT locked_until FROM users WHERE id = ?', ['h-lock']);
  assert.ok(Date.parse(row.locked_until) > Date.now() + 14 * 60_000);
  assert.equal((await auth.authenticate('h-lock', 'Hardening-password-123')).success, false, 'Đang khóa thì mật khẩu đúng cũng bị từ chối');
  assert.ok(await db.get("SELECT 1 AS x FROM audit_logs WHERE action = 'ACCOUNT_LOCKED' AND entity_id = 'h-lock'"));
  await db.run('UPDATE users SET locked_until = ? WHERE id = ?', [new Date(Date.now() - 1000).toISOString(), 'h-lock']);
  const ok = await auth.authenticate('h-lock', 'Hardening-password-123');
  assert.equal(ok.success, true);
  const cleared = await db.get('SELECT failed_login_count, locked_until FROM users WHERE id = ?', ['h-lock']);
  assert.equal(cleared.failed_login_count, 0);
  assert.equal(cleared.locked_until, null);
});

test('AUDIT: nhật ký kiểm toán không thể sửa hoặc xóa', async () => {
  await db.run("INSERT INTO audit_logs (user_id,action,entity_type,entity_id,details,created_at) VALUES ('h-admin','X','t','1','{}',?)", [new Date().toISOString()]);
  await assert.rejects(db.run("UPDATE audit_logs SET action = 'Y'"), /không được sửa/);
  await assert.rejects(db.run('DELETE FROM audit_logs'), /không được xóa/);
});

test('RBAC: cán bộ tiếp nhận chỉ xem hồ sơ/phản ánh và làm bước 1–2', async () => {
  assert.equal((await call('/api/internal/permits', { role: 'receptionist' })).status, 200);
  assert.equal((await call('/api/internal/complaints', { role: 'receptionist' })).status, 200);
  for (const route of ['/api/internal/reports/summary', '/api/internal/violations', '/api/internal/audit-logs', '/api/internal/inspections?permit_id=x']) {
    assert.equal((await call(route, { role: 'receptionist' })).status, 403, route);
  }
  assert.equal((await call('/api/internal/permits', { method: 'POST', role: 'receptionist', body: {} })).status, 403);
  assert.equal((await call('/api/internal/files/upload', { method: 'POST', role: 'receptionist', body: {} })).status, 403);
  assert.equal((await call('/api/internal/complaints/x/step', { method: 'POST', role: 'receptionist', body: { step: 5 } })).status, 403);
  assert.equal((await call('/api/internal/complaints/x/step', { method: 'POST', role: 'receptionist', body: { step: 4 } })).status, 403);
  assert.equal((await call('/api/internal/audit-logs', { role: 'admin' })).status, 200);
});

test('MIGRATION: CSDL cũ được nâng cấp (vai trò tiếp nhận, cột khóa, giữ khóa ngoại)', async () => {
  const oldPath = path.join(isolated, 'old.db');
  const old = new DatabaseSync(oldPath);
  old.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, full_name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','coordinator','inspector','citizen')), totp_secret TEXT, is_active INTEGER DEFAULT 1, created_at TEXT NOT NULL);
    CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL, created_at TEXT NOT NULL);
    INSERT INTO users VALUES ('u1','old','h','Old','admin',NULL,1,'2026-01-01');
    INSERT INTO sessions VALUES ('plain-token','u1','2999-01-01','2026-01-01');`);
  old.close();
  const { getDatabase } = await import('../src/db/database.js');
  const upgraded = getDatabase(oldPath);
  upgraded.prepare("INSERT INTO users (id,username,password_hash,full_name,role,created_at) VALUES ('u2','rc','h','R','receptionist','2026-01-01')").run();
  assert.equal(upgraded.prepare('SELECT COUNT(*) AS n FROM users').get().n, 2);
  assert.equal(upgraded.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 0, 'Phiên token dạng rõ phải bị thu hồi');
  assert.equal(upgraded.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.equal(upgraded.prepare('PRAGMA foreign_key_check').all().length, 0);
  assert.throws(() => upgraded.prepare("INSERT INTO sessions VALUES ('t','ghost','2999-01-01','x')").run(), /FOREIGN KEY/);
  getDatabase(process.env.DB_PATH);
});
