import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { isIP } from 'node:net';
import { fileURLToPath } from 'node:url';
import dbService from './db/database.js';
import authService from './services/auth.js';
import permitsService from './services/permits.js';
import complaintsService from './services/complaints.js';
import inspectionsService from './services/inspections.js';
import reportsService from './services/reports.js';
import storageService from './services/storage.js';
import gisService from './services/gis.js';
import batchImportService from './services/batch_import.js';
import violationsService from './services/violations.js';
import qrcodeService from './services/qrcode.js';

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const OFFICERS = ['admin', 'coordinator', 'inspector'];
const APPROVERS = ['admin', 'coordinator'];
const requestCounts = new Map();
const WINDOW_MS = 60_000;
let lastLimitCleanup = 0;
const isProduction = () => process.env.NODE_ENV === 'production';
function fail(message, statusCode = 400, code = 'INVALID_REQUEST') { return Object.assign(new Error(message), { statusCode, code }); }

function clientIp(req) {
  // Only the platform-owned header is trusted; arbitrary X-Forwarded-For is ignored.
  const platformIp = process.env.VERCEL === '1' ? req.headers['x-vercel-forwarded-for'] : null;
  if (typeof platformIp === 'string' && isIP(platformIp.trim())) return platformIp.trim();
  return req.socket?.remoteAddress || 'unknown';
}

async function checkRateLimit(identity, limit = 120) {
  const now = Date.now();
  const windowStart = Math.floor(now / WINDOW_MS) * WINDOW_MS;
  if (isProduction()) {
    const key = crypto.createHash('sha256').update(identity).digest('hex');
    if (now - lastLimitCleanup > WINDOW_MS) {
      lastLimitCleanup = now;
      await dbService.run('DELETE FROM rate_limits WHERE window_start < ?', [windowStart - WINDOW_MS]);
    }
    const result = await dbService.get(
      `INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN rate_limits.window_start = excluded.window_start THEN rate_limits.count + 1 ELSE 1 END,
         window_start = excluded.window_start RETURNING count`, [key, windowStart]
    );
    return Number(result.count) <= limit;
  }
  if (now - lastLimitCleanup > WINDOW_MS) {
    lastLimitCleanup = now;
    for (const [key, entry] of requestCounts) if (entry.windowStart !== windowStart) requestCounts.delete(key);
  }
  const entry = requestCounts.get(identity);
  if (!entry || entry.windowStart !== windowStart) {
    if (requestCounts.size >= 10_000) return false;
    requestCounts.set(identity, { windowStart, count: 1 });
    return true;
  }
  entry.count++;
  return entry.count <= limit;
}

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
  res.setHeader('Content-Security-Policy', `default-src 'self'; script-src 'self' https://unpkg.com 'unsafe-hashes' 'sha256-${printHash}'; style-src 'self' 'unsafe-inline' https://unpkg.com; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`);
  if (isProduction()) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
}
function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}
function sendError(res, statusCode, message, code = 'ERROR') { sendJson(res, statusCode, { success: false, error: { code, message } }); }
function redactReporterContacts(value) {
  if (Array.isArray(value)) return value.map(redactReporterContacts);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['sender_phone', 'sender_email', 'lookup_code'].includes(key))
    .map(([key, entry]) => [key, redactReporterContacts(entry)]));
  return value;
}
function dataResponse(res, data, status = 200, message) {
  sendJson(res, status, { success: true, data: res.restrictReporterContacts ? redactReporterContacts(data) : data, ...(message ? { message } : {}) });
}
function requireRole(user, roles = OFFICERS) {
  if (!user) throw fail('Vui lòng đăng nhập để thực hiện chức năng này', 401, 'UNAUTHORIZED');
  if (!roles.includes(user.role)) throw fail('Bạn không có quyền thực hiện chức năng này', 403, 'FORBIDDEN');
}

function expectedOrigins(req) {
  const origins = new Set();
  if (process.env.APP_ORIGIN) origins.add(new URL(process.env.APP_ORIGIN).origin);
  if (process.env.VERCEL === '1') {
    for (const host of [process.env.VERCEL_URL, process.env.VERCEL_PROJECT_PRODUCTION_URL]) if (host) origins.add(`https://${host}`);
  }
  if (!origins.size) origins.add(`${isProduction() || req.socket?.encrypted ? 'https' : 'http'}://${req.headers.host || 'localhost'}`);
  return origins;
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
async function parseBody(req) {
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
function queryOptions(url) {
  const limit = Number(url.searchParams.get('limit') ?? 100);
  const offset = Number(url.searchParams.get('offset') ?? 0);
  if (!Number.isInteger(limit) || limit < 1 || limit > 500 || !Number.isInteger(offset) || offset < 0) throw fail('Thông tin phân trang không hợp lệ');
  return { query: url.searchParams.get('query') || '', status: url.searchParams.get('status') || 'all', limit, offset };
}
function sessionCookie(token = '', maxAge = 86400) {
  return `session_id=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${isProduction() ? '; Secure' : ''}`;
}
function serveStatic(req, res, filePath) {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };
  res.writeHead(200, { 'Content-Type': types[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
  if (req.method === 'HEAD') return res.end();
  const stream = fs.createReadStream(filePath);
  stream.on('error', () => res.destroy());
  stream.pipe(res);
}
function csv(res, content, fileName) {
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${fileName}"` });
  res.end(content);
}
function html(res, content) { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(content); }
function svg(res, content) { res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8' }); res.end(content); }

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
      return dataResponse(res, { status: 'ok', app: 'QLTTXD Thảo Nguyên', version: '1.1.0', time: new Date().toISOString() });
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

    if (pathname === '/api/public/geojson/boundary' && method === 'GET') return dataResponse(res, await gisService.getWardGeoJson());
    if (pathname === '/api/public/permits' && method === 'GET') return dataResponse(res, await permitsService.getPublicPermits(queryOptions(url)));
    let match = pathname.match(/^\/api\/public\/permits\/([^/]+)(\/qrcode)?$/);
    if (match && method === 'GET') {
      const permit = await permitsService.getPermitById(match[1], false);
      if (!permit) throw fail('Không tìm thấy hồ sơ công trình', 404, 'NOT_FOUND');
      if (match[2]) return svg(res, qrcodeService.generateQrSvg(qrcodeService.getPermitQrUrl(permit.permit_number, [...expectedOrigins(req)][0]), { size: 240, padding: 3 }));
      return dataResponse(res, permit);
    }
    if (pathname === '/api/public/complaints' && method === 'POST') {
      if (!await checkRateLimit(`complaint:${ip}`, 10)) return sendError(res, 429, 'Vui lòng chờ trước khi gửi thêm phản ánh', 'RATE_LIMITED');
      return dataResponse(res, await complaintsService.submitComplaint(await parseBody(req), req.headers['idempotency-key'], currentUser?.user_id || 'anonymous'), 201, 'Đã tiếp nhận phản ánh thành công');
    }
    if (pathname === '/api/public/complaints/lookup' && method === 'GET') {
      if (!await checkRateLimit(`lookup:${ip}`, 30)) return sendError(res, 429, 'Vui lòng chờ trước khi tiếp tục tra cứu', 'RATE_LIMITED');
      const complaint = await complaintsService.lookupComplaint(url.searchParams.get('code'));
      if (!complaint) throw fail('Không tìm thấy phản ánh với mã đã cho', 404, 'NOT_FOUND');
      return dataResponse(res, complaint);
    }
    match = pathname.match(/^\/api\/public\/complaints\/([^/]+)\/qrcode$/);
    if (match && method === 'GET') {
      const complaint = await complaintsService.lookupComplaint(match[1]);
      if (!complaint) throw fail('Không tìm thấy phản ánh với mã đã cho', 404, 'NOT_FOUND');
      return svg(res, qrcodeService.generateQrSvg(qrcodeService.getComplaintQrUrl(match[1], [...expectedOrigins(req)][0]), { size: 240, padding: 3 }));
    }
    if (pathname === '/api/public/reports/export-csv' && method === 'GET') return csv(res, await reportsService.exportPermitsCsv(false), 'Cong_trinh_cong_khai.csv');

    if (pathname === '/api/internal/auth/login' && method === 'POST') {
      const body = await parseBody(req);
      const identity = typeof body.username === 'string' ? body.username.trim().toLowerCase().slice(0, 100) : '';
      if (!await checkRateLimit(`login-ip:${ip}`, 12) || !await checkRateLimit(`login-account:${identity}`, 12)) {
        res.setHeader('Retry-After', '60');
        return sendError(res, 429, 'Đã thử đăng nhập quá nhiều lần; vui lòng chờ 1 phút', 'RATE_LIMITED');
      }
      const result = await authService.authenticate(body.username, body.password, body.totp_token);
      if (!result.success) return sendJson(res, 401, result);
      if (!OFFICERS.includes(result.user.role)) {
        await authService.deleteSession(result.session.token);
        return sendError(res, 403, 'Tài khoản này không có quyền truy cập nghiệp vụ cán bộ', 'FORBIDDEN');
      }
      res.setHeader('Set-Cookie', sessionCookie(result.session.token));
      return sendJson(res, 200, { success: true, user: result.user });
    }
    if (pathname === '/api/internal/auth/logout' && method === 'POST') {
      requireRole(currentUser);
      await authService.deleteSession(sessionToken);
      res.setHeader('Set-Cookie', sessionCookie('', 0));
      return sendJson(res, 200, { success: true, message: 'Đã đăng xuất thành công' });
    }
    if (pathname === '/api/internal/auth/me' && method === 'GET') {
      requireRole(currentUser);
      return sendJson(res, 200, { success: true, user: currentUser });
    }

    if (pathname.startsWith('/api/internal/')) {
      requireRole(currentUser);
      const userId = currentUser.user_id;
      res.restrictReporterContacts = currentUser.role === 'inspector';
      if (pathname === '/api/internal/permits' && method === 'GET') return dataResponse(res, await permitsService.getInternalPermits(queryOptions(url)));
      if (pathname === '/api/internal/permits' && method === 'POST') {
        requireRole(currentUser, APPROVERS);
        return dataResponse(res, await permitsService.createPermit(await parseBody(req), userId), 201, 'Đã tạo hồ sơ giấy phép');
      }
      match = pathname.match(/^\/api\/internal\/permits\/([^/]+)\/publication$/);
      if (match && method === 'POST') {
        requireRole(currentUser, APPROVERS);
        return dataResponse(res, await permitsService.publishPermit(match[1], await parseBody(req), userId));
      }
      match = pathname.match(/^\/api\/internal\/permits\/([^/]+)\/resume$/);
      if (match && method === 'POST') {
        requireRole(currentUser, APPROVERS);
        return dataResponse(res, await permitsService.resumePermit(match[1], await parseBody(req), userId));
      }
      match = pathname.match(/^\/api\/internal\/permits\/([^/]+)$/);
      if (match && method === 'GET') {
        const permit = await permitsService.getPermitById(match[1], true);
        if (!permit) throw fail('Không tìm thấy hồ sơ', 404, 'NOT_FOUND');
        return dataResponse(res, permit);
      }
      if (pathname === '/api/internal/inspections' && method === 'GET') {
        const permitId = url.searchParams.get('permit_id');
        if (!permitId) throw fail('Thiếu hồ sơ công trình');
        return dataResponse(res, await inspectionsService.getInspectionsByPermit(permitId));
      }
      if (pathname === '/api/internal/inspections' && method === 'POST') return dataResponse(res, await inspectionsService.submitInspection(await parseBody(req), userId, req.headers['idempotency-key']), 201, 'Đã lập phiếu kiểm tra');
      match = pathname.match(/^\/api\/internal\/inspections\/([^/]+)\/approve$/);
      if (match && method === 'POST') {
        requireRole(currentUser, APPROVERS);
        return dataResponse(res, await inspectionsService.approveInspection(match[1], userId, await parseBody(req)));
      }
      match = pathname.match(/^\/api\/internal\/inspections\/([^/]+)\/print$/);
      if (match && method === 'GET') return html(res, await inspectionsService.generateInspectionPrintHtml(match[1]));
      if (pathname === '/api/internal/complaints' && method === 'GET') {
        const list = await complaintsService.getInternalComplaints(queryOptions(url));
        return dataResponse(res, list);
      }
      match = pathname.match(/^\/api\/internal\/complaints\/([^/]+)\/step$/);
      if (match && method === 'POST') {
        const body = await parseBody(req);
        if (currentUser.role === 'inspector') {
          if (![3, 4].includes(body.step) || body.reply !== undefined || body.assigned_to !== undefined || body.approved_read !== undefined) throw fail('Chỉ người điều phối mới có quyền phân công và phê duyệt phản hồi', 403, 'FORBIDDEN');
          const complaint = await complaintsService.getComplaintById(match[1]);
          if (!complaint || complaint.assigned_to !== userId) throw fail('Phản ánh chưa được phân công cho bạn', 403, 'FORBIDDEN');
        }
        return dataResponse(res, await complaintsService.updateComplaintStep(match[1], body, userId));
      }
      match = pathname.match(/^\/api\/internal\/complaints\/([^/]+)\/reopen$/);
      if (match && method === 'POST') {
        requireRole(currentUser, APPROVERS);
        return dataResponse(res, await complaintsService.reopenComplaint(match[1], userId, await parseBody(req)));
      }
      match = pathname.match(/^\/api\/internal\/complaints\/([^/]+)\/duplicates$/);
      if (match && method === 'GET') {
        requireRole(currentUser, APPROVERS);
        const radius = Number(url.searchParams.get('radius') ?? 100);
        if (!Number.isFinite(radius) || radius <= 0 || radius > 1000) throw fail('Bán kính tra cứu không hợp lệ');
        return dataResponse(res, await complaintsService.findDuplicateComplaints(match[1], radius));
      }
      match = pathname.match(/^\/api\/internal\/complaints\/([^/]+)\/merge$/);
      if (match && method === 'POST') {
        requireRole(currentUser, APPROVERS);
        const body = await parseBody(req);
        return dataResponse(res, await complaintsService.mergeComplaints(match[1], body.sourceIds, body.reason, userId, body));
      }
      if (pathname === '/api/internal/batch-import/preview' && method === 'POST') {
        requireRole(currentUser, APPROVERS);
        const body = await parseBody(req);
        if (typeof body.csvText !== 'string' || !body.csvText.trim()) throw fail('Thiếu nội dung tệp CSV');
        return dataResponse(res, await batchImportService.previewBatch(body.csvText));
      }
      if (pathname === '/api/internal/batch-import/commit' && method === 'POST') {
        requireRole(currentUser, APPROVERS);
        const body = await parseBody(req);
        if (!Array.isArray(body.validRows) || !body.validRows.length || body.validRows.length > 1000) throw fail('Cần từ 1 đến 1000 hồ sơ hợp lệ');
        return dataResponse(res, await batchImportService.commitBatch(body.validRows, userId, body.filename || 'import.csv', req.headers['idempotency-key']), 201);
      }
      if (pathname === '/api/internal/violations' && method === 'GET') return dataResponse(res, await violationsService.getViolations({ permitId: url.searchParams.get('permit_id'), status: url.searchParams.get('status'), overdueOnly: url.searchParams.get('overdue_only') === 'true' }));
      if (pathname === '/api/internal/violations' && method === 'POST') return dataResponse(res, await violationsService.createViolation(await parseBody(req), userId, req.headers['idempotency-key']), 201);
      match = pathname.match(/^\/api\/internal\/violations\/([^/]+)\/status$/);
      if (match && method === 'POST') {
        requireRole(currentUser, APPROVERS);
        return dataResponse(res, await violationsService.updateViolationStatus(match[1], await parseBody(req), userId));
      }
      match = pathname.match(/^\/api\/internal\/violations\/([^/]+)\/print$/);
      if (match && method === 'GET') return html(res, await violationsService.generateViolationPrintHtml(match[1]));
      match = pathname.match(/^\/api\/internal\/violations\/([^/]+)$/);
      if (match && method === 'GET') {
        const item = await violationsService.getViolationById(match[1]);
        if (!item) throw fail('Không tìm thấy biên bản', 404, 'NOT_FOUND');
        return dataResponse(res, item);
      }
      if (pathname === '/api/internal/reports/summary' && method === 'GET') return dataResponse(res, await reportsService.getSummaryReports());
      if (pathname === '/api/internal/reports/sub-areas' && method === 'GET') return dataResponse(res, await reportsService.getResidentialGroupStats());
      if (pathname === '/api/internal/reports/overdue' && method === 'GET') {
        const result = await reportsService.getOverdueTasks();
        return dataResponse(res, result);
      }
      if (pathname === '/api/internal/reports/export-csv' && method === 'GET') return csv(res, await reportsService.exportPermitsCsv(true), 'Bao_cao_cong_trinh.csv');
      if (pathname === '/api/internal/audit-logs' && method === 'GET') {
        requireRole(currentUser, ['admin']);
        return dataResponse(res, await reportsService.getAuditLogsReport({ ...queryOptions(url), action: url.searchParams.get('action'), entityType: url.searchParams.get('entity_type') }));
      }
      if (pathname === '/api/internal/reports/audit-logs/export-csv' && method === 'GET') {
        requireRole(currentUser, ['admin']);
        return csv(res, await reportsService.exportAuditLogsCsv(), 'Nhat_ky_kiem_toan.csv');
      }
      if (pathname === '/api/internal/files/upload' && method === 'POST') {
        const body = await parseBody(req);
        if (typeof body.base64 !== 'string' || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(body.base64)) throw fail('Dữ liệu ảnh không hợp lệ');
        return dataResponse(res, await storageService.saveFile({ buffer: Buffer.from(body.base64, 'base64'), originalName: body.fileName, mimeType: body.mimeType, ownerId: userId }), 201);
      }
    }
    match = pathname.match(/^\/api\/files\/([^/]+)$/);
    if (match && method === 'GET') {
      requireRole(currentUser);
      const file = await storageService.getFile(match[1], currentUser);
      if (!file) throw fail('Không tìm thấy tệp', 404, 'NOT_FOUND');
      res.writeHead(200, { 'Content-Type': file.mimeType, 'Content-Disposition': `inline; filename="${file.fileName}"` });
      return res.end(file.buffer);
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
