import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync, backup as sqliteBackup } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const PROJECT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BACKUP_FORMAT = 'qlttxd-sqlite-backup-v2';

export async function computeFileHash(filePath) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest('hex');
}
export function validLeafName(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 255 && !['.', '..'].includes(value) && !/[\\/\u0000-\u001f]/.test(value);
}
export async function regularFile(filePath) {
  const info = await fs.lstat(filePath);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('Bản sao chỉ được chứa tệp thường, không chứa liên kết');
  return info;
}

/** Check the actual database and every registered/attached photo in the snapshot. */
export async function verifySnapshot(dbPath, uploadsDir) {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  let files;
  try {
    const integrity = db.prepare('PRAGMA integrity_check').all();
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') throw new Error('CSDL không vượt qua integrity_check');
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('CSDL có tham chiếu khóa ngoại không hợp lệ');
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name));
    files = tables.has('files') ? db.prepare('SELECT file_name,file_size,sha256 FROM files').all() : [];
    if (tables.has('inspection_photos')) {
      const known = new Set(files.map(file => file.file_name));
      for (const photo of db.prepare('SELECT file_name,file_size,sha256_hash FROM inspection_photos').all()) {
        if (!known.has(photo.file_name)) {
          files.push({ file_name: photo.file_name, file_size: photo.file_size, sha256: photo.sha256_hash });
          known.add(photo.file_name);
        }
      }
    }
  } finally { db.close(); }
  for (const file of files) {
    if (!validLeafName(file.file_name) || !/^[a-f0-9]{64}$/.test(file.sha256 || '')) throw new Error('Metadata ảnh trong CSDL không hợp lệ; cần đối soát trước khi sao lưu');
    const filePath = path.join(uploadsDir, file.file_name);
    const info = await regularFile(filePath);
    if (info.size !== Number(file.file_size) || await computeFileHash(filePath) !== file.sha256) throw new Error('Ảnh trong bản sao không khớp metadata CSDL');
  }
  return { integrity_check: 'ok', foreign_key_errors: 0, verified_images: files.length };
}

export async function createBackup(options = {}) {
  if (process.env.DATABASE_URL) throw new Error('Đang cấu hình PostgreSQL. Dùng bản sao PostgreSQL và kho ảnh Supabase; không sao chép SQLite thay thế.');
  const startedAt = new Date();
  const started = performance.now();
  const dbPath = path.resolve(options.dbPath || process.env.DB_PATH || path.join(PROJECT_DIR, 'data/qlttxd.db'));
  const uploadsDir = path.resolve(options.uploadsDir || process.env.UPLOADS_DIR || path.join(PROJECT_DIR, 'data/uploads'));
  const backupsDir = path.resolve(options.backupsDir || process.env.BACKUPS_DIR || path.join(PROJECT_DIR, 'backups'));
  const geojsonPath = options.geojsonPath === null ? null : path.resolve(options.geojsonPath || process.env.GEOJSON_PATH || path.join(PROJECT_DIR, 'data/thao_nguyen_geo.json'));
  await regularFile(dbPath);
  await fs.mkdir(backupsDir, { recursive: true, mode: 0o700 });
  const name = `backup_${startedAt.toISOString().replace(/[:.]/g, '-')}_${crypto.randomUUID()}`;
  const backupFolder = path.join(backupsDir, name);
  const staging = await fs.mkdtemp(path.join(backupsDir, '.partial-'));
  const files = [];
  async function addFile(type, fileName) {
    const filePath = path.join(staging, fileName);
    const info = await regularFile(filePath);
    await fs.chmod(filePath, 0o600);
    files.push({ type, fileName, size: info.size, sha256: await computeFileHash(filePath) });
  }
  try {
    const source = new DatabaseSync(dbPath, { readOnly: true });
    try { await sqliteBackup(source, path.join(staging, 'qlttxd.db')); }
    finally { source.close(); }
    // A completed backup is a single self-contained file, with no required WAL sidecar.
    const snapshot = new DatabaseSync(path.join(staging, 'qlttxd.db'));
    try { snapshot.exec('PRAGMA journal_mode=DELETE;'); } finally { snapshot.close(); }
    await addFile('database', 'qlttxd.db');
    await fs.mkdir(path.join(staging, 'uploads'), { mode: 0o700 });
    let entries;
    try {
      const info = await fs.lstat(uploadsDir);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Thư mục ảnh không được là liên kết');
      entries = await fs.readdir(uploadsDir);
    } catch (error) { if (error.code === 'ENOENT') entries = []; else throw error; }
    for (const name of entries.sort()) {
      if (name === '.gitkeep') continue;
      if (!validLeafName(name)) throw new Error('Tên tệp ảnh không hợp lệ');
      const sourceFile = path.join(uploadsDir, name);
      await regularFile(sourceFile);
      await fs.copyFile(sourceFile, path.join(staging, 'uploads', name));
      await addFile('upload', `uploads/${name}`);
    }
    if (geojsonPath) {
      try {
        await regularFile(geojsonPath);
        await fs.copyFile(geojsonPath, path.join(staging, 'thao_nguyen_geo.json'));
        await addFile('geojson', 'thao_nguyen_geo.json');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    const checks = await verifySnapshot(path.join(staging, 'qlttxd.db'), path.join(staging, 'uploads'));
    const manifest = { format: BACKUP_FORMAT, started_at: startedAt.toISOString(), completed_at: new Date().toISOString(), duration_ms: Math.round(performance.now() - started), checks, files };
    await fs.writeFile(path.join(staging, 'manifest.json'), JSON.stringify(manifest, null, 2), { flag: 'wx', mode: 0o600 });
    await fs.rename(staging, backupFolder);
    return { backupFolder, manifest };
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true });
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await createBackup();
    console.log(JSON.stringify({ success: true, backupFolder: result.backupFolder, duration_ms: result.manifest.duration_ms, files: result.manifest.files.length, checks: result.manifest.checks }, null, 2));
  } catch (error) { console.error(`Sao lưu không thành công: ${error.message}`); process.exitCode = 1; }
}
export default createBackup;
