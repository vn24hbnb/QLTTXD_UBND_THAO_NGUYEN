// Tiện ích HTTP dùng chung cho máy chủ và các nhóm route.

export const OFFICERS = ['admin', 'coordinator', 'inspector', 'receptionist'];
export const APPROVERS = ['admin', 'coordinator'];
export const isProduction = () => process.env.NODE_ENV === 'production';
export function fail(message, statusCode = 400, code = 'INVALID_REQUEST') { return Object.assign(new Error(message), { statusCode, code }); }

export function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}
export function sendError(res, statusCode, message, code = 'ERROR') { sendJson(res, statusCode, { success: false, error: { code, message } }); }
function redactReporterContacts(value) {
  if (Array.isArray(value)) return value.map(redactReporterContacts);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['sender_phone', 'sender_email', 'lookup_code'].includes(key))
    .map(([key, entry]) => [key, redactReporterContacts(entry)]));
  return value;
}
export function dataResponse(res, data, status = 200, message) {
  sendJson(res, status, { success: true, data: res.restrictReporterContacts ? redactReporterContacts(data) : data, ...(message ? { message } : {}) });
}
export function requireRole(user, roles = OFFICERS) {
  if (!user) throw fail('Vui lòng đăng nhập để thực hiện chức năng này', 401, 'UNAUTHORIZED');
  if (!roles.includes(user.role)) throw fail('Bạn không có quyền thực hiện chức năng này', 403, 'FORBIDDEN');
}

export function expectedOrigins(req) {
  const origins = new Set();
  if (process.env.APP_ORIGIN) origins.add(new URL(process.env.APP_ORIGIN).origin);
  if (process.env.VERCEL === '1') {
    for (const host of [process.env.VERCEL_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]) if (host) origins.add(`https://${host}`);
  }
  if (!origins.size) origins.add(`${isProduction() || req.socket?.encrypted ? 'https' : 'http'}://${req.headers.host || 'localhost'}`);
  return origins;
}
export async function parseBody(req) {
  const maxBytes = 4_400_000; // A 3 MiB image plus base64 and JSON, below Vercel's 4.5 MB limit.
  if (Number(req.headers['content-length']) > maxBytes) throw fail('Dữ liệu vượt quá giới hạn 4,4 MB', 413, 'PAYLOAD_TOO_LARGE');
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) throw fail('Yêu cầu phải sử dụng JSON', 415, 'UNSUPPORTED_MEDIA_TYPE');
  if (req.body !== undefined) {
    let value;
    try { value = typeof req.body === 'string' ? JSON.parse(req.body) : req.body; }
    catch { throw fail('Dữ liệu JSON không hợp lệ'); }
    if (Buffer.byteLength(JSON.stringify(value)) > maxBytes) throw fail('Dữ liệu vượt quá giới hạn 4,4 MB', 413);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('Dữ liệu JSON phải là một đối tượng');
    return value;
  }
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > maxBytes) throw fail('Dữ liệu vượt quá giới hạn 4,4 MB', 413, 'PAYLOAD_TOO_LARGE');
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
  catch { throw fail('Dữ liệu JSON không hợp lệ'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw fail('Dữ liệu JSON phải là một đối tượng');
  return value;
}
export function queryOptions(url) {
  const limit = Number(url.searchParams.get('limit') ?? 100);
  const offset = Number(url.searchParams.get('offset') ?? 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500 || !Number.isInteger(offset) || offset < 0) throw fail('Thông tin phân trang không hợp lệ');
  return { query: url.searchParams.get('query') || '', status: url.searchParams.get('status') || 'all', limit, offset };
}
export function sessionCookie(token = '', maxAge = 86400) {
  return `session_id=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${isProduction() ? '; Secure' : ''}`;
}
export function csv(res, content, fileName) {
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${fileName}"` });
  res.end(content);
}
export function html(res, content) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(content); }
export function svg(res, content) { res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8' }); res.end(content); }
