import crypto from 'node:crypto';
import { promisify } from 'node:util';
import dbService from '../db/database.js';
import { audit } from './validation.js';

const SESSION_DURATION_HOURS = 24;
const scryptAsync = promisify(crypto.scrypt);
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;
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

// Chỉ băm SHA-256 của token được lưu trong CSDL; token gốc chỉ nằm trong cookie của người dùng.
export function hashSessionToken(token) { return crypto.createHash('sha256').update(token).digest('hex'); }

const TOTP_PREFIX = 'enc:v1:';
function totpKey() {
  const secret = process.env.TOTP_ENCRYPTION_KEY;
  if (!secret) return null;
  if (secret.length < 32) throw new Error('TOTP_ENCRYPTION_KEY phải dài ít nhất 32 ký tự');
  return crypto.createHash('sha256').update(secret).digest();
}
/** Mã hóa AES-256-GCM khóa TOTP trước khi lưu; production bắt buộc có TOTP_ENCRYPTION_KEY. */
export function sealTotpSecret(secret) {
  if (!secret) return null;
  const key = totpKey();
  if (!key) {
    if (process.env.NODE_ENV === 'production') throw new Error('Thiếu TOTP_ENCRYPTION_KEY để mã hóa khóa TOTP');
    return secret;
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return `${TOTP_PREFIX}${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${body.toString('base64url')}`;
}
export function openTotpSecret(stored) {
  if (typeof stored !== 'string' || !stored.startsWith(TOTP_PREFIX)) return stored; // khóa cũ chưa mã hóa
  const key = totpKey();
  const [iv, tag, body] = stored.slice(TOTP_PREFIX.length).split(':');
  if (!key || !iv || !tag || !body) return null;
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
  } catch { return null; }
}

export async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_HOURS * 3600 * 1000).toISOString();
  await dbService.run('DELETE FROM sessions WHERE expires_at < ?', [now.toISOString()]);
  await dbService.run('INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)', [hashSessionToken(token), userId, expiresAt, now.toISOString()]);
  return { token, expiresAt };
}

export async function getSession(token) {
  if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
  const session = await dbService.get(
    `SELECT s.expires_at, u.id AS user_id, u.id AS id, u.username, u.full_name, u.role
     FROM sessions s JOIN users u ON s.user_id = u.id
     WHERE s.token = ? AND u.is_active = 1`, [hashSessionToken(token)]
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
  await dbService.run('DELETE FROM sessions WHERE token = ?', [hashSessionToken(token)]);
}

async function recordFailedLogin(user) {
  const row = await dbService.get('UPDATE users SET failed_login_count = failed_login_count + 1 WHERE id = ? RETURNING failed_login_count', [user.id]);
  if (Number(row?.failed_login_count) >= MAX_FAILED_LOGINS) {
    const lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString();
    await dbService.run('UPDATE users SET locked_until = ?, failed_login_count = 0 WHERE id = ?', [lockedUntil, user.id]);
    await audit(dbService, user.id, 'ACCOUNT_LOCKED', 'users', user.id, { lockedUntil });
  }
}

export async function authenticate(username, password, totpToken = null) {
  const denied = { success: false, error: 'Tên đăng nhập hoặc mật khẩu không chính xác' };
  if (typeof username !== 'string' || username.length > 100 || typeof password !== 'string' || password.length > 1024) return denied;
  const user = await dbService.get('SELECT * FROM users WHERE username = ? AND is_active = 1', [username.trim()]);
  // Luôn băm mật khẩu để thời gian phản hồi không tiết lộ tài khoản có tồn tại hoặc đang khóa.
  const passwordOk = await verifyPassword(password, user?.password_hash);
  if (!user) return denied;
  if (user.locked_until && Date.parse(user.locked_until) > Date.now()) return denied;
  if (!passwordOk) { await recordFailedLogin(user); return denied; }
  if (user.totp_secret && !verifyTotp(openTotpSecret(user.totp_secret), totpToken)) {
    if (typeof totpToken === 'string' && totpToken.trim()) await recordFailedLogin(user);
    return { success: false, requireTotp: true, error: 'Vui lòng cung cấp mã xác thực TOTP hợp lệ' };
  }
  if (!user.password_hash.startsWith('scrypt$v1$')) {
    const newHash = hashPassword(password);
    await dbService.run('UPDATE users SET password_hash = ? WHERE id = ? AND password_hash = ?', [newHash, user.id, user.password_hash]);
  }
  if (user.failed_login_count || user.locked_until) await dbService.run('UPDATE users SET failed_login_count = 0, locked_until = NULL WHERE id = ?', [user.id]);
  const session = await createSession(user.id);
  return { success: true, user: { id: user.id, user_id: user.id, username: user.username, full_name: user.full_name, role: user.role }, session };
}

export default { hashPassword, hashSessionToken, sealTotpSecret, openTotpSecret, verifyTotp, createSession, getSession, deleteSession, authenticate };
