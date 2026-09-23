import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// Each test worker gets an empty disposable database; never touch user data.
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'qlttxd-test-'));
process.env.NODE_ENV='test';
delete process.env.DATABASE_URL;
delete process.env.SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
process.env.DB_PATH=path.join(dir,'qlttxd.db');
process.env.UPLOADS_DIR=path.join(dir,'uploads');
const {seed}=await import('../src/db/seed.js');
seed();
process.on('exit',()=>fs.rmSync(dir,{recursive:true,force:true}));
