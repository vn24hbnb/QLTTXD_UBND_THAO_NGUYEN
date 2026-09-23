import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import sharp from 'sharp';

// This suite always owns a disposable database and image directory.
const isolated = await fs.mkdtemp(path.join(os.tmpdir(), 'qlttxd-http-security-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(isolated, 'test.db');
process.env.UPLOADS_DIR = path.join(isolated, 'uploads');
delete process.env.DATABASE_URL;
delete process.env.SUPABASE_URL;
delete process.env.APP_ORIGIN;
const { default: db, closeDatabase } = await import('../src/db/database.js');
const { default: auth } = await import('../src/services/auth.js');
const { default: storage } = await import('../src/services/storage.js');
const { default: permits } = await import('../src/services/permits.js');
const { createServer, requestHandler } = await import('../src/server.js');
let server;
let base;
let png;
const sessions = {};

before(async () => {
  await db.ready();
  const now = new Date().toISOString();
  const passwordHash = auth.hashPassword('Http-test-password-123');
  for (const role of ['admin', 'coordinator', 'inspector', 'citizen']) {
    await db.run('INSERT INTO users (id,username,password_hash,full_name,role,is_active,created_at) VALUES (?,?,?,?,?,1,?)', [`http-${role}`, `http-${role}`, passwordHash, `HTTP ${role}`, role, now]);
    sessions[role] = (await auth.createSession(`http-${role}`)).token;
  }
  await db.run('INSERT INTO users (id,username,password_hash,full_name,role,is_active,created_at) VALUES (?,?,?,?,?,1,?)', ['http-other-inspector', 'http-other-inspector', passwordHash, 'HTTP inspector khác', 'inspector', now]);
  sessions.otherInspector = (await auth.createSession('http-other-inspector')).token;
  await db.run(`INSERT INTO permits (id,permit_number,issue_date,issuing_authority,owner_name,owner_address,construction_type,site_address,status,current_stage,version_id,is_public,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,0,1,1,?,?)`, ['http-permit', 'HTTP-2026-001', '2026-09-01', 'UBND phường', 'PRIVATE OWNER', 'PRIVATE RESIDENCE', 'Nhà ở riêng lẻ', 'Địa điểm công trình', 'Cần kiểm tra', now, now]);
  png = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#126789' } }).png().toBuffer();
  server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await closeDatabase();
  await fs.rm(isolated, { recursive: true, force: true });
});

async function request(route, { method = 'GET', role, body, origin = base, headers = {} } = {}) {
  const response = await fetch(`${base}${route}`, {
    method,
    headers: {
      ...(role ? { Cookie: `session_id=${sessions[role]}` } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(method !== 'GET' && origin ? { Origin: origin } : {}),
      ...headers
    },
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const buffer = Buffer.from(await response.arrayBuffer());
  let json;
  if ((response.headers.get('content-type') || '').includes('application/json')) json = JSON.parse(buffer.toString());
  return { status: response.status, headers: response.headers, json, buffer };
}

async function upload(role = 'inspector', fileName = 'image.png', buffer = png, mimeType = 'image/png') {
  return request('/api/internal/files/upload', { method: 'POST', role, body: { fileName, mimeType, base64: buffer.toString('base64') } });
}

test('HTTP: cookie sai định dạng trả 400, máy chủ tiếp tục phục vụ', async () => {
  const invalid = await request('/api/health', { headers: { Cookie: 'session_id=%' } });
  assert.equal(invalid.status, 400);
  assert.equal((await request('/api/health')).status, 200);
  assert.equal((await request('/api/public/permits', { headers: { Cookie: 'other=%E0' } })).status, 400);
});

test('HTTP: API không tồn tại trả JSON 404, không trả trang HTML', async () => {
  for (const [route, role] of [['/api/public/does-not-exist', undefined], ['/api/internal/does-not-exist', 'inspector']]) {
    const response = await request(route, { role });
    assert.equal(response.status, 404);
    assert.equal(response.json.error.code, 'NOT_FOUND');
    assert.match(response.headers.get('content-type'), /application\/json/);
  }
});

test('HTTP: khách và citizen không đọc hoặc ghi được dữ liệu cán bộ', async () => {
  const routes = ['/api/internal/permits', '/api/internal/permits/http-permit', '/api/internal/complaints', '/api/internal/reports/summary', '/api/internal/reports/export-csv', '/api/internal/auth/me'];
  for (const route of routes) {
    assert.equal((await request(route)).status, 401, route);
    assert.equal((await request(route, { role: 'citizen' })).status, 403, route);
  }
  for (const route of ['/api/internal/inspections', '/api/internal/files/upload', '/api/internal/violations']) {
    assert.equal((await request(route, { method: 'POST', role: 'citizen', body: {} })).status, 403, route);
  }
  const publicPermits = await request('/api/public/permits');
  assert.equal(publicPermits.status, 200);
  assert.equal(Object.hasOwn(publicPermits.json.data[0], 'owner_name'), false);
  assert.equal(Object.hasOwn(publicPermits.json.data[0], 'owner_address'), false);
  const internal = await request('/api/internal/permits', { role: 'inspector' });
  assert.equal(internal.status, 200);
  assert.equal(internal.json.data[0].owner_name, 'PRIVATE OWNER');
});

test('HTTP: inspector không tự phê duyệt, phân công, mở lại hoặc công khai hồ sơ', async () => {
  for (const [route, body] of [
    ['/api/internal/inspections/unknown/approve', { version_id: 1 }],
    ['/api/internal/permits/http-permit/publication', { is_public: true, version_id: 1 }],
    ['/api/internal/complaints/unknown/step', { step: 5, reply: 'Unauthorized', version_id: 1 }],
    ['/api/internal/complaints/unknown/step', { step: 2, assigned_to: 'http-inspector', version_id: 1 }],
    ['/api/internal/complaints/unknown/reopen', { version_id: 1 }],
    ['/api/internal/complaints/unknown/merge', { sourceIds: ['other'] }],
    ['/api/internal/violations/unknown/status', { status: 'đã_khắc_phục' }]
  ]) assert.equal((await request(route, { method: 'POST', role: 'inspector', body })).status, 403, route);
  assert.equal((await request('/api/internal/audit-logs', { role: 'coordinator' })).status, 403);
});

test('HTTP: cookie phiên ghi dữ liệu phải có nguồn hợp lệ', async () => {
  const body = { permit_number: 'CSRF', site_address: 'CSRF' };
  assert.equal((await request('/api/internal/permits', { method: 'POST', role: 'admin', body, origin: 'https://other.example' })).status, 403);
  assert.equal((await request('/api/internal/permits', { method: 'POST', role: 'admin', body, origin: null })).status, 403);
  assert.equal((await request('/api/internal/auth/login', { method: 'POST', body: {}, origin: 'https://other.example' })).status, 403);
});

test('HTTP: tệp riêng tư cần metadata và đúng quyền, không thể upload HTML/PDF giả ảnh', async () => {
  assert.equal((await upload('inspector', 'exploit.html', Buffer.from('%PDF-1.4<script>alert(1)</script>'), 'application/pdf')).status, 400);
  assert.equal((await upload('inspector', 'truncated.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), 'image/png')).status, 400);
  const saved = await upload('inspector', 'actual-photo.html');
  assert.equal(saved.status, 201);
  assert.match(saved.json.data.fileName, /^[a-f0-9-]{36}\.png$/);
  const route = `/api/files/${saved.json.data.fileName}`;
  assert.equal((await request(route)).status, 401);
  assert.equal((await request(route, { role: 'citizen' })).status, 403);
  assert.equal((await request(route, { role: 'otherInspector' })).status, 403);
  const owner = await request(route, { role: 'inspector' });
  assert.equal(owner.status, 200);
  assert.equal(owner.headers.get('content-type'), 'image/png');
  assert.equal(owner.headers.get('x-content-type-options'), 'nosniff');
  assert.equal((await request(route, { role: 'admin' })).status, 200);
  const metadata = await storage.getFileMetadata(saved.json.data.fileName);
  assert.equal(metadata.owner_id, 'http-inspector');
  assert.equal(crypto.createHash('sha256').update(owner.buffer).digest('hex'), metadata.sha256);
  const unknown = `${crypto.randomUUID()}.png`;
  await fs.writeFile(path.join(process.env.UPLOADS_DIR, unknown), png);
  assert.equal((await request(`/api/files/${unknown}`, { role: 'admin' })).status, 404);
  await fs.writeFile(path.join(process.env.UPLOADS_DIR, saved.json.data.fileName), Buffer.from('tampered'));
  assert.equal((await request(route, { role: 'admin' })).status, 503);
});

test('HTTP: phản hồi nội bộ không cache, không lộ lỗi cơ sở dữ liệu', async () => {
  const good = await request('/api/internal/permits', { role: 'inspector' });
  assert.equal(good.headers.get('cache-control'), 'no-store');
  assert.equal(good.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(good.headers.get('access-control-allow-origin'), null);
  assert.match(good.headers.get('content-security-policy'), /object-src 'none'/);
  const previous = permits.getInternalPermits;
  permits.getInternalPermits = async () => { throw new Error('database password PRIVATE-SECRET at /private/database.db'); };
  try {
    const result = await request('/api/internal/permits', { role: 'inspector' });
    assert.equal(result.status, 500);
    assert.doesNotMatch(result.buffer.toString(), /PRIVATE-SECRET|private\/database/);
  } finally { permits.getInternalPermits = previous; }
});

test('HTTP: nội dung JSON lỗi được trả 400 cả native HTTP và req.body của Vercel', async () => {
  const native = await fetch(`${base}/api/internal/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base }, body: '{bad' });
  assert.equal(native.status, 400);
  const fake = {
    headers: {}, status: 0, body: '', headersSent: false,
    setHeader(key, value) { this.headers[key] = value; },
    writeHead(status, headers) { this.status = status; Object.assign(this.headers, headers); this.headersSent = true; },
    end(body) { this.body = body || ''; }
  };
  await requestHandler({ url: '/api/internal/auth/login', method: 'POST', headers: { 'content-type': 'application/json', host: 'localhost' }, socket: { remoteAddress: '127.0.0.2' }, body: '{bad' }, fake);
  assert.equal(fake.status, 400);
  assert.equal(JSON.parse(fake.body).success, false);
});

test('AUTH: scrypt có salt riêng, hash cũ chỉ nâng cấp sau đăng nhập thành công', async () => {
  const first = auth.hashPassword('Same-password-123');
  const second = auth.hashPassword('Same-password-123');
  assert.notEqual(first, second);
  assert.match(first, /^scrypt\$v1\$/);
  const legacy = crypto.createHash('sha256').update('Legacy-password-123qlttxd_salt_2026').digest('hex');
  await db.run('INSERT INTO users (id,username,password_hash,full_name,role,is_active,created_at) VALUES (?,?,?,?,?,1,?)', ['http-legacy', 'http-legacy', legacy, 'Legacy user', 'inspector', new Date().toISOString()]);
  assert.equal((await auth.authenticate('http-legacy', 'wrong')).success, false);
  assert.equal((await db.get('SELECT password_hash FROM users WHERE id = ?', ['http-legacy'])).password_hash, legacy);
  const result = await auth.authenticate('http-legacy', 'Legacy-password-123');
  assert.equal(result.success, true);
  assert.match((await db.get('SELECT password_hash FROM users WHERE id = ?', ['http-legacy'])).password_hash, /^scrypt\$v1\$/);
  const session = await auth.getSession(result.session.token);
  assert.equal(session.user_id, 'http-legacy');
  assert.equal(Object.hasOwn(session, 'token'), false);
  await auth.deleteSession(result.session.token);
  assert.equal(await auth.getSession(result.session.token), null);
});

test('HTTP: login citizen bị chặn, cán bộ nhận phiên HttpOnly SameSite và role thật', async () => {
  const denied = await request('/api/internal/auth/login', { method: 'POST', body: { username: 'http-citizen', password: 'Http-test-password-123' } });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('set-cookie'), null);
  const allowed = await request('/api/internal/auth/login', { method: 'POST', body: { username: 'http-inspector', password: 'Http-test-password-123' } });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.json.user.role, 'inspector');
  assert.equal(allowed.json.user.id, allowed.json.user.user_id);
  assert.match(allowed.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  assert.equal(Object.hasOwn(allowed.json, 'session'), false);
});

test('HTTP: chỉ điều phối được tiếp tục công trình sau khi gỡ lệnh dừng', async () => {
  const permit = await permits.createPermit({
    permit_number: `RESUME-${crypto.randomUUID()}`,
    issue_date: '2026-09-01',
    issuing_authority: 'Cơ quan thử nghiệm',
    construction_type: 'Nhà ở',
    site_address: 'Địa điểm thử nghiệm',
    owner_name: 'Chủ hộ thử nghiệm',
    longitude: 104.688,
    latitude: 20.893
  }, 'http-admin');
  const stopped = await permits.updatePermitStatus(permit.id, {
    status: 'Tạm dừng', version_id: permit.version_id
  }, 'http-admin');
  const route = `/api/internal/permits/${permit.id}/resume`;
  const body = { version_id: stopped.version_id, reason: 'Đã xử lý và kiểm tra xong vi phạm' };

  assert.equal((await request(route, { method: 'POST', body })).status, 401);
  assert.equal((await request(route, { method: 'POST', role: 'inspector', body })).status, 403);
  const resumed = await request(route, { method: 'POST', role: 'coordinator', body });
  assert.equal(resumed.status, 200);
  assert.equal(resumed.json.data.status, 'Cần kiểm tra');
  assert.equal(resumed.json.data.version_id, stopped.version_id + 1);
  assert.equal((await request(route, { method: 'POST', role: 'coordinator', body })).status, 409);
});
