import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createBackup} from '../scripts/backup.js';
import {restoreBackup} from '../scripts/restore.js';

test('BACKUP: Bản sao chứa giao dịch còn trong WAL và phục hồi vào môi trường sạch',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'qlttxd-recovery-'));
 const dbPath=path.join(dir,'source.db');const db=new DatabaseSync(dbPath);
 try {
 db.exec('PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; CREATE TABLE evidence(id INTEGER PRIMARY KEY,value TEXT); INSERT INTO evidence VALUES(1,\'giao dịch chưa checkpoint\');');
 assert.ok((await fs.stat(dbPath+'-wal')).size>0);
 const backup=await createBackup({dbPath,uploadsDir:path.join(dir,'uploads'),backupsDir:path.join(dir,'backups'),geojsonPath:null});
 const result=await restoreBackup(backup.backupFolder,{destinationDir:path.join(dir,'clean')});
 const restored=new DatabaseSync(result.dbPath,{readOnly:true});
 try{assert.equal(restored.prepare('SELECT value FROM evidence WHERE id=1').get().value,'giao dịch chưa checkpoint');}finally{restored.close();}
 assert.equal(result.checks.integrity_check,'ok');assert.equal(result.checks.foreign_key_errors,0);
 assert.ok(result.duration_ms<8*60*60*1000);assert.ok(result.recovery_point_age_seconds<86400);
 await assert.rejects(restoreBackup(backup.backupFolder,{destinationDir:path.join(dir,'clean')}),/đã tồn tại/);
 await fs.appendFile(path.join(backup.backupFolder,'qlttxd.db'),'tampered');
 await assert.rejects(restoreBackup(backup.backupFolder,{destinationDir:path.join(dir,'tampered')}),/SHA-256/);
 await assert.rejects(fs.stat(path.join(dir,'tampered')),e=>e.code==='ENOENT');
 }finally{db.close();await fs.rm(dir,{recursive:true,force:true});}
});
test('RESTORE: Từ chối đường dẫn ra ngoài thư mục và đích không rõ ràng',async()=>{
 await assert.rejects(restoreBackup('irrelevant'),/thư mục phục hồi mới/);
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'qlttxd-manifest-'));
 try{
 await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify({format:'qlttxd-sqlite-backup-v2',started_at:new Date().toISOString(),completed_at:new Date().toISOString(),files:[{type:'upload',fileName:'uploads/../../target',size:0,sha256:'0'.repeat(64)}]}));
 await assert.rejects(restoreBackup(dir,{destinationDir:dir+'-new'}),/Manifest chứa đường dẫn/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
