import crypto from 'node:crypto';
import dbService from '../db/database.js';

export function fail(message, statusCode = 400, code = 'VALIDATION_ERROR') {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.status = statusCode;
  error.code = code;
  throw error;
}
export function text(value, name, { required = false, max = 10000 } = {}) {
  if (value == null || value === '') {
    if (required) fail(`Thiếu ${name}`);
    return null;
  }
  if (typeof value !== 'string') fail(`${name} phải là chuỗi ký tự`);
  const result = value.trim();
  if (required && !result) fail(`Thiếu ${name}`);
  if (result.length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(result)) fail(`${name} không hợp lệ`);
  return result || null;
}
export function number(value, name, { min = 0, max = 1000000000, integer = false, required = false } = {}) {
  if (value == null || value === '' || (typeof value === 'string' && !value.trim())) {
    if (required) fail(`Thiếu ${name}`);
    return null;
  }
  if (!['number', 'string'].includes(typeof value)) fail(`${name} phải là số`);
  const result = Number(value);
  if (!Number.isFinite(result) || result < min || result > max || (integer && !Number.isInteger(result))) fail(`${name} không hợp lệ`);
  return result;
}
export function date(value, name, { required = false } = {}) {
  const result = text(value, name, { required, max: 10 });
  if (result == null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || !Number.isFinite(Date.parse(result)) || new Date(result).toISOString().slice(0, 10) !== result) fail(`${name} phải là ngày có thực theo YYYY-MM-DD`);
  return result;
}
export function coordinates(longitude, latitude, { required = false } = {}) {
  const lng = number(longitude, 'kinh độ', { min: -180, max: 180, required });
  const lat = number(latitude, 'vĩ độ', { min: -90, max: 90, required });
  if ((lng == null) !== (lat == null)) fail('Phải nhập đồng thời kinh độ và vĩ độ');
  return { longitude: lng, latitude: lat };
}
export function expectedVersion(value, actual) {
  const version = number(value, 'phiên bản hồ sơ', { min: 1, integer: true, required: true });
  if (version !== actual) fail('Hồ sơ đã được cập nhật. Vui lòng tải lại trước khi ghi.', 409, 'VERSION_CONFLICT');
  return version;
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
}
export async function idempotent(endpoint, userId, clientKey, payload, operation) {
  if (!clientKey) return dbService.transaction(operation);
  const key = text(clientKey, 'Idempotency-Key', { required: true, max: 200 });
  if (key.length < 16) fail('Idempotency-Key phải có ít nhất 16 ký tự ngẫu nhiên');
  const scope = crypto.createHash('sha256').update(JSON.stringify([endpoint, userId, key])).digest('hex');
  const requestHash = crypto.createHash('sha256').update(JSON.stringify(stable(payload))).digest('hex');
  const readExisting = async () => {
    const row = await dbService.get('SELECT request_hash, response_body FROM idempotency_keys WHERE key = ?', [scope]);
    if (!row) return null;
    if (row.request_hash !== requestHash) fail('Idempotency-Key đã được sử dụng cho nội dung khác.', 409, 'IDEMPOTENCY_CONFLICT');
    return { value: JSON.parse(row.response_body) };
  };
  const existing = await readExisting();
  if (existing) return existing.value;
  try {
    return await dbService.transaction(async db => {
      await db.run('INSERT INTO idempotency_keys (key,user_id,endpoint,request_hash,response_code,response_body,created_at) VALUES (?,?,?,?,?,?,?)', [scope,userId,endpoint,requestHash,201,'null',new Date().toISOString()]);
      const result = await operation(db);
      await db.run('UPDATE idempotency_keys SET response_body = ? WHERE key = ?', [JSON.stringify(result),scope]);
      return result;
    });
  } catch (error) {
    // A concurrent request may have committed the same key while this request waited.
    if (/unique|duplicate/i.test(error.message) || error.code === '23505') {
      const cached = await readExisting();
      if (cached) return cached.value;
    }
    throw error;
  }
}
export async function requireStaff(userId, roles = ['admin', 'coordinator', 'inspector']) {
  const user = await dbService.get('SELECT id, role, is_active FROM users WHERE id = ?', [userId]);
  if (!user || !user.is_active || !roles.includes(user.role)) fail('Bạn không có quyền thực hiện thao tác này.', 403, 'FORBIDDEN');
  return user;
}
export async function audit(db, userId, action, entity, id, details) {
  await db.run('INSERT INTO audit_logs (user_id,action,entity_type,entity_id,details,created_at) VALUES (?,?,?,?,?,?)', [userId,action,entity,id,JSON.stringify(details),new Date().toISOString()]);
}
