// Kiểm tra bản sao lưu mới nhất còn trong hạn RPO. Thoát mã 1 nếu quá hạn hoặc thiếu bản sao lưu,
// để cron/giám sát cảnh báo. Dùng: node scripts/check-backup-freshness.js [thư-mục-backups] [số-giờ]
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function latestBackupAge(root, now = Date.now()) {
  let names = [];
  try { names = await fs.readdir(root); } catch { return null; }
  let newest = null;
  for (const name of names.filter(n => /^(cloud|backup)_/.test(n))) {
    try {
      const manifest = JSON.parse(await fs.readFile(path.join(root, name, 'manifest.json'), 'utf8'));
      const at = Date.parse(manifest.completed_at || manifest.created_at || manifest.started_at);
      if (Number.isFinite(at) && (!newest || at > newest.at)) newest = { name, at };
    } catch { /* thư mục dở dang hoặc không có manifest không được tính là bản sao lưu hợp lệ */ }
  }
  return newest && { name: newest.name, ageHours: (now - newest.at) / 3_600_000 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.argv[2] || 'backups');
  const limit = Number(process.argv[3] || 24);
  const result = await latestBackupAge(root);
  if (!result) { console.error(`CẢNH BÁO: không có bản sao lưu hợp lệ trong ${root}`); process.exit(1); }
  if (result.ageHours > limit) { console.error(`CẢNH BÁO: bản sao lưu mới nhất (${result.name}) đã ${result.ageHours.toFixed(1)} giờ, vượt RPO ${limit} giờ`); process.exit(1); }
  console.log(`Bản sao lưu ${result.name} còn hạn: ${result.ageHours.toFixed(1)} giờ (RPO ${limit} giờ)`);
}
