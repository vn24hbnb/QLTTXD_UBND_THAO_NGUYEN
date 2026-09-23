import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BACKUP_FORMAT, computeFileHash, regularFile, validLeafName, verifySnapshot } from './backup.js';
export { computeFileHash } from './backup.js';

function validateManifest(manifest) {
  if (!manifest || manifest.format !== BACKUP_FORMAT || !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 100000) throw new Error('Manifest không đúng định dạng bản sao QLTTXD v2');
  const started = Date.parse(manifest.started_at);
  const completed = Date.parse(manifest.completed_at);
  if (!Number.isFinite(started) || !Number.isFinite(completed) || completed < started || started > Date.now() + 60000) throw new Error('Mốc thời gian trong manifest không hợp lệ');
  const names = new Set();
  let databases = 0;
  for (const file of manifest.files) {
    const legalPath = (file.type === 'database' && file.fileName === 'qlttxd.db') ||
      (file.type === 'geojson' && file.fileName === 'thao_nguyen_geo.json') ||
      (file.type === 'upload' && typeof file.fileName === 'string' && file.fileName.startsWith('uploads/') && validLeafName(file.fileName.slice(8)));
    if (!legalPath || names.has(file.fileName) || !Number.isSafeInteger(file.size) || file.size < 0 || !/^[a-f0-9]{64}$/.test(file.sha256 || '')) throw new Error('Manifest chứa đường dẫn, kích thước hoặc mã băm không hợp lệ');
    names.add(file.fileName);
    if (file.type === 'database') databases++;
  }
  if (databases !== 1) throw new Error('Bản sao phải có đúng một CSDL');
}

async function verifyFiles(root, files) {
  for (const file of files) {
    if (file.type === 'upload') {
      const directory = await fs.lstat(path.join(root, 'uploads'));
      if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('Bản sao không được chứa thư mục liên kết');
    }
    const source = path.join(root, file.fileName);
    const info = await regularFile(source);
    if (info.size !== file.size || await computeFileHash(source) !== file.sha256) throw new Error('Tệp trong bản sao bị thay đổi hoặc sai mã SHA-256');
  }
}

export async function restoreBackup(backupFolder, { destinationDir } = {}) {
  if (typeof backupFolder !== 'string' || !backupFolder.trim()) throw new Error('Phải chỉ rõ bản sao cần phục hồi');
  if (typeof destinationDir !== 'string' || !destinationDir.trim()) throw new Error('Phải chỉ rõ thư mục phục hồi mới; không ghi đè dữ liệu đang chạy');
  const startedAt = Date.now();
  const started = performance.now();
  const source = path.resolve(backupFolder);
  const destination = path.resolve(destinationDir);
  const sourceInfo = await fs.lstat(source);
  if (!sourceInfo.isDirectory() || sourceInfo.isSymbolicLink()) throw new Error('Bản sao phải là thư mục thật');
  try { await fs.lstat(destination); throw new Error('Thư mục đích đã tồn tại; chỉ phục hồi vào thư mục mới'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const manifestPath = path.join(source, 'manifest.json');
  const manifestInfo = await regularFile(manifestPath);
  if (manifestInfo.size > 16 * 1024 * 1024) throw new Error('Manifest vượt quá kích thước cho phép');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  validateManifest(manifest);
  await verifyFiles(source, manifest.files);
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const staging = await fs.mkdtemp(path.join(path.dirname(destination), '.restore-'));
  try {
    await fs.mkdir(path.join(staging, 'uploads'), { mode: 0o700 });
    for (const file of manifest.files) {
      const target = path.join(staging, file.fileName);
      await fs.copyFile(path.join(source, file.fileName), target);
      await fs.chmod(target, 0o600);
    }
    await verifyFiles(staging, manifest.files);
    const checks = await verifySnapshot(path.join(staging, 'qlttxd.db'), path.join(staging, 'uploads'));
    // Reserve the destination after validation. Never replace an existing directory.
    await fs.mkdir(destination, { mode: 0o700 });
    try {
      for (const name of await fs.readdir(staging)) await fs.rename(path.join(staging, name), path.join(destination, name));
    } catch (error) { await fs.rm(destination, { recursive: true, force: true }); throw error; }
    await fs.rmdir(staging);
    return {
      success: true, manifest, checks, destinationDir: destination,
      dbPath: path.join(destination, 'qlttxd.db'), uploadsDir: path.join(destination, 'uploads'),
      duration_ms: Math.round(performance.now() - started),
      recovery_point_age_seconds: Math.max(0, Math.ceil((startedAt - Date.parse(manifest.started_at)) / 1000))
    };
  } catch (error) { await fs.rm(staging, { recursive: true, force: true }); throw error; }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await restoreBackup(process.argv[2], { destinationDir: process.argv[3] });
    console.log(JSON.stringify({ success: true, destinationDir: result.destinationDir, dbPath: result.dbPath, uploadsDir: result.uploadsDir, duration_ms: result.duration_ms, recovery_point_age_seconds: result.recovery_point_age_seconds, checks: result.checks }, null, 2));
  } catch (error) { console.error(`Phục hồi không thành công: ${error.message}`); process.exitCode = 1; }
}
export default restoreBackup;
