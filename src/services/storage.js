import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { createClient } from '@supabase/supabase-js';
import dbService from '../db/database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ALLOWED_MIME_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png' };
export const MAX_FILE_SIZE = 3 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 40_000_000;
let supabaseClient;
let bucketReady;

function failure(message, statusCode = 400) { return Object.assign(new Error(message), { statusCode }); }
function uploadsDirectory() { return path.resolve(process.env.UPLOADS_DIR || path.join(__dirname, '../../data/uploads')); }
function storageClient() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (process.env.SUPABASE_URL && key) {
    supabaseClient ||= createClient(process.env.SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    return supabaseClient;
  }
  if (process.env.NODE_ENV === 'production') throw failure('Kho ảnh riêng tư chưa được cấu hình', 503);
  return null;
}
function bucketName() { return process.env.SUPABASE_STORAGE_BUCKET || 'qlttxd-private'; }

async function privateBucket(client) {
  if (!bucketReady) {
    bucketReady = (async () => {
      const { data, error } = await client.storage.getBucket(bucketName());
      if (error) throw failure('Không thể truy cập kho ảnh riêng tư', 503);
      if (data.public) throw failure('Cấu hình kho ảnh chưa đáp ứng quyền truy cập riêng tư', 503);
    })().catch(error => { bucketReady = null; throw error; });
  }
  await bucketReady;
  return client.storage.from(bucketName());
}

export async function ensureUploadsDir() { await fs.mkdir(uploadsDirectory(), { recursive: true, mode: 0o700 }); }

// Fast pre-check only. saveFile decodes and re-encodes every accepted image below.
export function verifyMagicBytes(buffer, mimeType) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) return false;
  if (mimeType === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  return false;
}

export async function saveFile({ buffer, originalName, mimeType, ownerId }) {
  if (!ALLOWED_MIME_TYPES[mimeType]) throw failure('Chỉ chấp nhận ảnh JPEG hoặc PNG trong mốc thử nghiệm');
  if (typeof originalName !== 'string' || !originalName.trim() || originalName.length > 255) throw failure('Tên tệp không hợp lệ');
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > MAX_FILE_SIZE) throw failure('Kích thước ảnh phải từ 1 byte đến 3 MB');
  if (!verifyMagicBytes(buffer, mimeType)) throw failure('Nội dung ảnh không khớp định dạng khai báo');
  const owner = await dbService.get('SELECT id, role FROM users WHERE id = ? AND is_active = 1', [ownerId || '']);
  if (!owner || !['admin', 'coordinator', 'inspector'].includes(owner.role)) throw failure('Không có quyền tải ảnh', 403);
  let cleanBuffer;
  try {
    const picture = sharp(buffer, { failOn: 'warning', limitInputPixels: MAX_IMAGE_PIXELS });
    const metadata = await picture.metadata();
    if (metadata.format !== (mimeType === 'image/jpeg' ? 'jpeg' : 'png') || (metadata.pages || 1) > 1) throw new Error('invalid image');
    cleanBuffer = await (mimeType === 'image/jpeg' ? picture.rotate().jpeg({ quality: 90 }) : picture.rotate().png()).toBuffer();
  } catch { throw failure('Ảnh bị lỗi hoặc không phải ảnh JPEG/PNG hợp lệ'); }
  if (cleanBuffer.length > MAX_FILE_SIZE) throw failure('Ảnh sau xử lý vượt quá 3 MB');
  const fileName = `${crypto.randomUUID()}${ALLOWED_MIME_TYPES[mimeType]}`;
  const sha256 = crypto.createHash('sha256').update(cleanBuffer).digest('hex');
  const client = storageClient();
  const bucket = client ? await privateBucket(client) : null;
  if (bucket) {
    const { error } = await bucket.upload(fileName, cleanBuffer, { contentType: mimeType, upsert: false, cacheControl: '0' });
    if (error) throw failure('Không thể lưu ảnh; vui lòng thử lại', 503);
  } else {
    await ensureUploadsDir();
    await fs.writeFile(path.join(uploadsDirectory(), fileName), cleanBuffer, { flag: 'wx', mode: 0o600 });
  }
  try {
    await dbService.run(
      'INSERT INTO files (file_name, original_name, mime_type, file_size, sha256, owner_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [fileName, path.basename(originalName), mimeType, cleanBuffer.length, sha256, ownerId, new Date().toISOString()]
    );
  } catch (error) {
    if (bucket) await bucket.remove([fileName]);
    else await fs.unlink(path.join(uploadsDirectory(), fileName)).catch(() => {});
    throw error;
  }
  return { fileName, fileSize: cleanBuffer.length, mimeType, sha256 };
}

export async function getFileMetadata(fileName) {
  if (typeof fileName !== 'string' || !/^[a-f0-9-]{36}\.(?:jpg|png)$/.test(fileName)) return null;
  return await dbService.get('SELECT file_name, original_name, mime_type, file_size, sha256, owner_id, created_at FROM files WHERE file_name = ?', [fileName]) || null;
}

export async function getFile(fileName, currentUser) {
  if (!currentUser || !['admin', 'coordinator', 'inspector'].includes(currentUser.role)) throw failure('Không có quyền xem tệp', 403);
  const metadata = await getFileMetadata(fileName);
  if (!metadata) return null;
  const userId = currentUser.user_id || currentUser.id;
  if (currentUser.role === 'inspector' && metadata.owner_id !== userId) {
    const assigned = await dbService.get(
      'SELECT p.file_name FROM inspection_photos p JOIN inspections i ON p.inspection_id = i.id WHERE p.file_name = ? AND i.inspector_id = ?',
      [fileName, userId]
    );
    if (!assigned) throw failure('Không có quyền xem tệp', 403);
  }
  const client = storageClient();
  let buffer;
  if (client) {
    const bucket = await privateBucket(client);
    const { data, error } = await bucket.download(fileName);
    if (error) throw failure('Không thể đọc ảnh; vui lòng thử lại', 503);
    buffer = Buffer.from(await data.arrayBuffer());
  } else {
    try { buffer = await fs.readFile(path.join(uploadsDirectory(), fileName)); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  if (buffer.length !== Number(metadata.file_size) || crypto.createHash('sha256').update(buffer).digest('hex') !== metadata.sha256) {
    throw failure('Ảnh không vượt qua kiểm tra toàn vẹn', 503);
  }
  return { buffer, mimeType: metadata.mime_type, fileName: metadata.file_name };
}

export default { saveFile, getFile, getFileMetadata, verifyMagicBytes };
