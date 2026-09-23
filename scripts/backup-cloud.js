import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {createClient} from '@supabase/supabase-js';
import db,{closeDatabase} from '../src/db/database.js';
import {computeFileHash} from './backup.js';
if(db.dialect!=='postgres')throw new Error('Cần DATABASE_URL PostgreSQL');
const root=path.resolve(process.env.BACKUPS_DIR||'backups');
await fs.mkdir(root,{recursive:true,mode:0o700});
const started=Date.now();
const destination=path.join(root,'cloud_'+new Date().toISOString().replace(/[:.]/g,'-'));
const stage=await fs.mkdtemp(path.join(root,'.partial-cloud-'));
const url=new URL(process.env.DATABASE_BACKUP_URL||process.env.DATABASE_URL);
const client=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SUPABASE_SECRET_KEY,{auth:{persistSession:false}});
try{
 const cert=path.join(stage,'ca.crt');await fs.writeFile(cert,process.env.DATABASE_CA_CERT.replace(/\\n/g,'\n'),{mode:0o600});
 const env={...process.env,PGHOST:url.hostname,PGPORT:url.port||'5432',PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:url.pathname.slice(1),PGSSLMODE:'verify-full',PGSSLROOTCERT:cert};
 await new Promise((resolve,reject)=>{
  const p=spawn(process.env.PG_DUMP||'pg_dump',['--format=custom','--schema=public','--no-owner','--no-acl','--enable-row-security','--file',path.join(stage,'database.dump')],{env,stdio:['ignore','ignore','pipe']});
  let error='';p.stderr.on('data',chunk=>{error+=chunk});p.on('error',reject);p.on('close',code=>code===0?resolve():reject(new Error('pg_dump không thành công: '+error)));
 });
 await fs.rm(cert);
 await fs.mkdir(path.join(stage,'uploads'),{mode:0o700});
 const tableNames=['users','sessions','permits','inspections','inspection_photos','complaints','audit_logs','idempotency_keys','violations','import_batches','files','permit_history','rate_limits'];
 const recordCounts={};
 for(const table of tableNames) recordCounts[table]=Number((await db.get('SELECT COUNT(*) AS n FROM '+table)).n);
 const files=await db.all('SELECT file_name,file_size,sha256 FROM files');
 for(const file of files){
  if(!/^[a-f0-9-]{36}\.(jpg|png)$/.test(file.file_name))throw new Error('Tên ảnh không hợp lệ');
  const {data,error}=await client.storage.from(process.env.SUPABASE_STORAGE_BUCKET||'qlttxd-private').download(file.file_name);
  if(error)throw new Error('Không tải được ảnh sao lưu');
  const buffer=Buffer.from(await data.arrayBuffer());
  if(buffer.length!==Number(file.file_size)||crypto.createHash('sha256').update(buffer).digest('hex')!==file.sha256)throw new Error('Ảnh không khớp metadata');
  await fs.writeFile(path.join(stage,'uploads',file.file_name),buffer,{mode:0o600});
 }
 const entries=['database.dump',...files.map(f=>'uploads/'+f.file_name)];
 const manifest={format:'qlttxd-postgres-backup-v1',created_at:new Date().toISOString(),duration_ms:Date.now()-started,recordCounts,files:await Promise.all(entries.map(async fileName=>({fileName,sha256:await computeFileHash(path.join(stage,fileName)),size:(await fs.stat(path.join(stage,fileName))).size})))};
 await fs.chmod(path.join(stage,'database.dump'),0o600);
 await fs.writeFile(path.join(stage,'manifest.json'),JSON.stringify(manifest,null,2),{mode:0o600});
 await fs.rename(stage,destination);
 console.log(JSON.stringify({success:true,destination,files:entries.length,duration_ms:manifest.duration_ms}));
}catch(error){await fs.rm(stage,{recursive:true,force:true});console.error(error.message);process.exitCode=1;}finally{await closeDatabase();}
