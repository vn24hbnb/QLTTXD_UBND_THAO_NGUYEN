import crypto from 'node:crypto';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import authService from './services/auth.js';

import { NOT_HANDLED, handlePublic } from './routes/public.js';
import { handleInternal } from './routes/internal.js';
import { fail, sendJson, sendError, dataResponse, expectedOrigins, isProduction } from './http/helpers.js';
import { clientIp, checkRateLimit } from './http/rate_limit.js';

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const APP_VERSION = (() => {
  try { return JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../package.json'), 'utf8')).version; }
  catch { return 'unknown'; }
})();

function parseCookies(req) {
  const cookies = Object.create(null);
  for (const part of (req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const name = part.slice(0, index).trim();
    try { cookies[name] = decodeURIComponent(part.slice(index + 1)); }
    catch { throw fail('Cookie không hợp lệ'); }
  }
  return cookies;
}

function headers(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)');
  const printHash = crypto.createHash('sha256').update('window.print()').digest('base64');
  res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self' 'unsafe-hashes' 'sha256-${printHash}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`);
  if (isProduction()) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}
function checkWriteOrigin(req, hasCookieSession) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
  const source = req.headers.origin || req.headers.referer;
  if (req.headers['sec-fetch-site'] === 'cross-site') throw fail('Yêu cầu từ nguồn không được phép', 403, 'INVALID_ORIGIN');
  if (source) {
    let origin;
    try { origin = new URL(source).origin; } catch { throw fail('Nguồn yêu cầu không hợp lệ', 403, 'INVALID_ORIGIN'); }
    if (!expectedOrigins(req).has(origin)) throw fail('Yêu cầu từ nguồn không được phép', 403, 'INVALID_ORIGIN');
  } else if (hasCookieSession) {
    throw fail('Thiếu thông tin xác minh nguồn yêu cầu', 403, 'INVALID_ORIGIN');
  }
}
function serveStatic(req, res, filePath) {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
  res.writeHead(200, { 'Content-Type': types[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
  if (req.method === 'HEAD') return res.end();
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}

export async function requestHandler(req, res) {
  headers(res);
  try {
    const url = new URL(req.url, 'http://localhost');
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { throw fail('Đường dẫn không hợp lệ'); }
    const method = req.method;
    if (pathname === '/api/health' && method === 'GET') {
      // Liveness does not depend on a mutable demo database or a session.
      parseCookies(req);
      return dataResponse(res, { status: 'ok', app: 'QLTTXD Thảo Nguyên', version: APP_VERSION, time: new Date().toISOString() });
    }
    if (!pathname.startsWith('/api/')) {
      if (!['GET', 'HEAD'].includes(method)) return sendError(res, 404, 'Không tìm thấy đường dẫn', 'NOT_FOUND');
      const staticPath = path.resolve(PUBLIC_DIR, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!staticPath.startsWith(`${PUBLIC_DIR}${path.sep}`)) throw fail('Đường dẫn không hợp lệ');
      if (fs.existsSync(staticPath) && fs.statSync(staticPath).isFile()) return serveStatic(req, res, staticPath);
      return sendError(res, 404, 'Không tìm thấy tệp', 'NOT_FOUND');
    }
    const ip = clientIp(req);
    if (!await checkRateLimit(`api:${ip}`)) {
      res.setHeader('Retry-After', '60');
      return sendError(res, 429, 'Quá nhiều yêu cầu, vui lòng thử lại sau 1 phút', 'RATE_LIMITED');
    }
    const cookies = parseCookies(req);
    const bearer = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '')?.[1];
    const sessionToken = cookies.session_id || bearer;
    const currentUser = sessionToken ? await authService.getSession(sessionToken) : null;
    checkWriteOrigin(req, Boolean(currentUser && cookies.session_id));
    if (method === 'OPTIONS') return sendError(res, 405, 'Ứng dụng chỉ tiếp nhận yêu cầu cùng nguồn', 'METHOD_NOT_ALLOWED');

    const ctx = { req, res, url, pathname, method, ip, currentUser, sessionToken };
    if (await handlePublic(ctx) !== NOT_HANDLED) return;
    if (pathname.startsWith('/api/internal/') || pathname.startsWith('/api/files/')) {
      if (await handleInternal(ctx) !== NOT_HANDLED) return;
    }
    return sendError(res, 404, 'Endpoint không tồn tại', 'NOT_FOUND');
  } catch (error) {
    if (res.headersSent) { res.destroy(); return; }
    const status = Number(error.statusCode || error.status);
    if (Number.isInteger(status) && status >= 400 && status < 500) return sendError(res, status, error.message, error.code || 'INVALID_REQUEST');
    if (['23505', 'SQLITE_CONSTRAINT_UNIQUE', 'SQLITE_CONSTRAINT_PRIMARYKEY'].includes(error.code) || /UNIQUE constraint failed/.test(error.message || '')) return sendError(res, 409, 'Dữ liệu bị trùng hoặc đã thay đổi; vui lòng tải lại', 'CONFLICT');
    if (['23503', '23514', 'SQLITE_CONSTRAINT_FOREIGNKEY', 'SQLITE_CONSTRAINT_CHECK'].includes(error.code) || /(?:FOREIGN KEY|CHECK) constraint failed/.test(error.message || '')) return sendError(res, 400, 'Dữ liệu không đáp ứng điều kiện nghiệp vụ', 'INVALID_REQUEST');
    // Do not log payloads, session tokens, database URLs or raw database errors.
    console.error('Lỗi xử lý yêu cầu', { name: error.name || 'Error', code: error.code || 'INTERNAL_ERROR' });
    return sendError(res, status === 503 ? 503 : 500, 'Không thể xử lý yêu cầu; vui lòng thử lại sau', 'SERVER_ERROR');
  }
}

export function createServer() { return http.createServer(requestHandler); }

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Demo data must be requested explicitly via the separate development seed command.
  await dbService.ready();
  const port = Number(process.env.PORT) || 3982;
  const server = createServer();
  server.listen(port, process.env.HOST || '127.0.0.1', () => console.log(`QLTTXD đang phục vụ tại cổng ${port}`));
  server.on('error', error => { console.error('Không thể mở máy chủ', { code: error.code }); process.exitCode = 1; });
}

export default createServer;
