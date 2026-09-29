import authService from '../services/auth.js';
import permitsService from '../services/permits.js';
import complaintsService from '../services/complaints.js';
import inspectionsService from '../services/inspections.js';
import reportsService from '../services/reports.js';
import storageService from '../services/storage.js';
import gisService from '../services/gis.js';
import batchImportService from '../services/batch_import.js';
import violationsService from '../services/violations.js';
import qrcodeService from '../services/qrcode.js';
import { OFFICERS, APPROVERS, fail, sendJson, sendError, dataResponse, requireRole, expectedOrigins, parseBody, queryOptions, sessionCookie, csv, html, svg } from '../http/helpers.js';
import { checkRateLimit } from '../http/rate_limit.js';

export const NOT_HANDLED = Symbol('not-handled');

/** Route công khai: không cần đăng nhập, không trả dữ liệu định danh. */
export async function handlePublic({ req, res, url, pathname, method, ip, currentUser }) {
  let match;
  if (pathname === '/api/public/geojson/boundary' && method === 'GET') return dataResponse(res, await gisService.getWardGeoJson());
  if (pathname === '/api/public/permits' && method === 'GET') return dataResponse(res, await permitsService.getPublicPermits(queryOptions(url)));
  match = pathname.match(/^\/api\/public\/permits\/([^/]+)(\/qrcode)?$/);
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
  if (pathname === '/api/public/complaints/map' && method === 'GET') return dataResponse(res, await complaintsService.getPublicComplaintPins());
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
  return NOT_HANDLED;
}
