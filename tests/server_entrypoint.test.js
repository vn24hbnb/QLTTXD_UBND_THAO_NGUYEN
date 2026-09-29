import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

test('ENTRYPOINT: `node src/server.js` khởi động thật và trả /api/health', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qlttxd-entry-'));
  const port = 39000 + Math.floor(Math.random() * 500);
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, NODE_ENV: 'test', PORT: String(port), DB_PATH: path.join(dir, 'e.db'), UPLOADS_DIR: path.join(dir, 'u'), DATABASE_URL: '' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', d => { stderr += d; });
  try {
    let body;
    for (let i = 0; i < 50 && !body; i++) {
      if (child.exitCode !== null) break;
      try { body = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json(); } catch { await new Promise(r => setTimeout(r, 100)); }
    }
    assert.ok(body, `Máy chủ không khởi động được: ${stderr}`);
    assert.equal(body.data.status, 'ok');
    assert.match(body.data.version, /^\d+\.\d+\.\d+$/);
    const index = await fetch(`http://127.0.0.1:${port}/vendor/leaflet/leaflet.js`);
    assert.equal(index.status, 200);
  } finally {
    child.kill();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
