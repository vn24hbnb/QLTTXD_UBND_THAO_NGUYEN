import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { latestBackupAge } from '../scripts/check-backup-freshness.js';

test('BACKUP: đo tuổi bản sao lưu hợp lệ mới nhất, bỏ qua thư mục dở dang', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'qlttxd-fresh-'));
  const now = Date.parse('2026-09-29T12:00:00Z');
  try {
    assert.equal(await latestBackupAge(path.join(root, 'missing'), now), null);
    assert.equal(await latestBackupAge(root, now), null);
    await fs.mkdir(path.join(root, 'cloud_old')); await fs.writeFile(path.join(root, 'cloud_old/manifest.json'), JSON.stringify({ created_at: '2026-09-27T12:00:00Z' }));
    await fs.mkdir(path.join(root, 'cloud_new')); await fs.writeFile(path.join(root, 'cloud_new/manifest.json'), JSON.stringify({ created_at: '2026-09-29T06:00:00Z' }));
    await fs.mkdir(path.join(root, 'cloud_partial'));
    const result = await latestBackupAge(root, now);
    assert.equal(result.name, 'cloud_new');
    assert.equal(result.ageHours, 6);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
