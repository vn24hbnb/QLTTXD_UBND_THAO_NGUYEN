import crypto from 'node:crypto';
import { promisify } from 'node:util';
import dbService from '../db/database.js';

const SESSION_DURATION_HOURS = 24;
const scryptAsync = promisify(crypto.scrypt);
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const DUMMY_SALT = '72c2ab9512fd9d491c0f6e2f357b98d4';

export function hashPassword(password) {
  if (typeof password !== 'string' || !password || password.length > 1024) {
    throw new TypeError('Mật khẩu không hợp lệ');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64, SCRYPT_OPTIONS).toString('hex');
  return `scrypt$v1$${salt}$${hash}`;
}

async function verifyPassword(password, storedHash) {
  if (typeof password !== 'string' || !password || password.length > 1024) return false;
  const parts = typeof storedHash === 'string' ? storedHash.split('$') : [];
  if (parts.length === 4 && parts[0] === 'scrypt' && parts[1] === 'v1' && /^[a-f0-9]{32}$/.test(parts[2]) && /^[a-f0-9]{128}$/.test(parts[3])) {
    const candidate = await scryptAsync(password, parts[2], 64, SCRYPT_OPTIONS);
    return crypto.timingSafeEqual(candidate, Buffer.from(parts[3], 'hex'));
  }
  // Read legacy hashes only to migrate an existing account after a successful login.
  await scryptAsync(password, DUMMY_SALT, 64, SCRYPT_OPTIONS);
  if (!/^[a-f0-9]{64}$/.test(storedHash || '')) return false;
  const legacyHash = crypto.createHash('sha256').update(password + 'qlttxd_salt_2026').digest();
  return crypto.timingSafeEqual(legacyHash, Buffer.from(storedHash, 'hex'));
}

/** Verify a six-digit TOTP within one 30-second interval of server time. */
export function verifyTotp(secretBase32, token, window = 1) {
  if (typeof token !== 'string' || !/^\d{6}$/.test(token.trim()) || typeof secretBase32 !== 'string') return false;
  const normalizedSecret = secretBase32.toUpperCase().replace(/=+$/, '');
  if (!/^[A-Z2-7]+$/.test(normalizedSecret)) return false;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of normalizedSecret) bits += alphabet.indexOf(char).toString(2).padStart(5, '0');
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  const key = Buffer.from(bytes);
  const currentCounter = Math.floor(Date.now() / 30000);
  const safeWindow = Number.isInteger(window) ? Math.min(2, Math.max(0, window)) : 1;
  for (let offset = -safeWindow; offset <= safeWindow; offset++) {
    const counterBuffer = Buffer.alloc(8);
    counterBuffer.writeBigUInt64BE(BigInt(currentCounter + offset));
    const hmac = crypto.createHmac('sha1', key).update(counterBuffer).digest();
    const index = hmac[hmac.length - 1] & 0xf;
    const value = hmac.readUInt32BE(index) & 0x7fffffff;
    const expected = String(value % 1000000).padStart(6, '0');
    if (crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(token.trim()))) return true;
  }
  return false;
}

export async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_HOURS * 3600 * 1000).toISOString();
  await dbService.run('DELETE FROM sessions WHERE expires_at < ?', [now.toISOString()]);
  await dbService.run('INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)', [token, userId, expiresAt, now.toISOString()]);
  return { token, expiresAt };
}

export async function getSession(token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
  const session = await dbService.get(
    `SELECT s.expires_at, u.id AS user_id, u.id AS id, u.username, u.full_name, u.role
     FROM sessions s JOIN users u ON s.user_id = u.id
     WHERE s.token = ? AND u.is_active = 1`, [token]
  );
  if (!session) return null;
  if (!Number.isFinite(Date.parse(session.expires_at)) || Date.parse(session.expires_at) <= Date.now()) {
    await deleteSession(token);
    return null;
  }
  return session;
}

export async function deleteSession(token) {
  if (typeof token !== 'string' || !token) return;
  await dbService.run('DELETE FROM sessions WHERE token = ?', [token]);
}

export async function authenticate(username, password, totpToken = null) {
  const denied = { success: false, error: 'Tên đăng nhập hoặc mật khẩu không chính xác' };
  if (typeof username !== 'string' || username.length > 100 || typeof password !== 'string' || password.length > 1024) return denied;
  const user = await dbService.get('SELECT * FROM users WHERE username = ? AND is_active = 1', [username.trim()]);
  if (!await verifyPassword(password, user?.password_hash)) return denied;
  if (!user) return denied;
  if (user.totp_secret && !verifyTotp(user.totp_secret, totpToken)) {
    return { success: false, requireTotp: true, error: 'Vui lòng cung cấp mã xác thực TOTP hợp lệ' };
  }
  if (!user.password_hash.startsWith('scrypt$v1$')) {
    const newHash = hashPassword(password);
    await dbService.run('UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ?', [newHash, user.id, user.password_hash]);
  }
  const session = await createSession(user.id);
  return { success: true, user: { id: user.id, user_id: user.id, username: user.username, full_name: user.full_name, role: user.role }, session };
}

export default { hashPassword, verifyTotp, createSession, getSession, deleteSession, authenticate };
