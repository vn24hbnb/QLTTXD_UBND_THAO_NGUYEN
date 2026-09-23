import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn} from 'node:child_process';
import {createClient} from '@supabase/supabase-js';
import {computeFileHash,regularFile} from './backup.js';
const [backupFolder]=process.argv.slice(2);
const databaseUrl=process.env.DATABASE_RESTORE_URL;
if(!backupFolder||!databaseUrl||!process.env.DATABASE_CA_CERT||!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY){console.error('Cần thư mục backup, DATABASE_RESTORE_URL của CSDL MỚI, DATABASE_CA_CERT, SUPABASE_URL và SUPABASE_SERVICE_ROLE_KEY.');process.exit(1);}
const folder=path.resolve(backupFolder);const manifest=JSON.parse(await fs.readFile(path.join(folder,'manifest.json'),'utf8'));
if(manifest.format!=='qlttxd-postgres-backup-v1'||!Array.isArray(manifest.files)||!manifest.files.some(f=>f.fileName==='database.dump'))throw new Error('Bản sao không đúng định dạng');
for(const file of manifest.files){
 if(!/^(?:database\.dump|uploads\/[a-f0-9-]{36}\.(?:jpg|png))$/.test(file.fileName))throw new Error('Bản sao có đường dẫn không hợp lệ');
 const local=path.join(folder,file.fileName);const info=await regularFile(local);
 if(info.size!==file.size||await computeFileHash(local)!==file.sha256)throw new Error('Bản sao không vượt qua kiểm tra SHA-256');
}
const url=new URL(databaseUrl);const options={host:url.hostname,port:Number(url.port||5432),database:decodeURIComponent(url.pathname.slice(1)),user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),ssl:{rejectUnauthorized:true,ca:process.env.DATABASE_CA_CERT.replace(/\\n/g,'\n')},connectionTimeoutMillis:10000};
const {Pool}=await import('pg');const pool=new Pool({...options,max:1});
const storage=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const bucketName=process.env.SUPABASE_STORAGE_BUCKET||'qlttxd-private';
const clientTemp=await fs.mkdtemp(path.join(folder,'.restore-'));
const uploaded=[];
try{
 const inventory=await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'");
 if(inventory.rows.length)throw new Error('Chỉ phục hồi được vào CSDL mới có schema public rỗng');
 const schema=await pool.query("SELECT to_regnamespace('extensions') AS extensions");
 if(!schema.rows[0].extensions)throw new Error('CSDL đích cần cài PostGIS trong schema extensions trước khi phục hồi');
 const role=await pool.query("SELECT 1 FROM pg_roles WHERE rolname='qlttxd_backend'");
 if(!role.rowCount)await pool.query('CREATE ROLE qlttxd_backend NOLOGIN');
 const {data:bucket,error:bucketError}=await storage.storage.getBucket(bucketName);
 if(bucketError)throw new Error('Cần tạo kho ảnh riêng tư trước khi phục hồi');
 if(bucket.public)throw new Error('Kho ảnh đích phải đặt riêng tư');
 const uploads=manifest.files.filter(f=>f.fileName.startsWith('uploads/'));
 const existing=await storage.storage.from(bucketName).list('',{limit:100});
 if(existing.error||existing.data?.length)throw new Error('Kho ảnh đích phải còn trống để tránh ghi đè tệp');
 if(uploads.length>100)throw new Error('Phục hồi theo lô ảnh tối đa 100; chia bộ dữ liệu và đối soát thủ công');
 for(const file of uploads){
  const name=path.basename(file.fileName);const content=await fs.readFile(path.join(folder,file.fileName));
  const {error}=await storage.storage.from(bucketName).upload(name,content,{upsert:false,contentType:name.endsWith('.png')?'image/png':'image/jpeg',cacheControl:'0'});
  if(error)throw new Error('Không thể phục hồi một ảnh vào kho riêng tư');
  uploaded.push(name);
 }
 const tocFile=path.join(clientTemp,'restore.list');
 const toc=await new Promise((resolve,reject)=>{
  const child=spawn(process.env.PG_RESTORE||'pg_restore',['--list',path.join(folder,'database.dump')],{stdio:['ignore','pipe','pipe']});let out='',err='';child.stdout.on('data',c=>out+=c);child.stderr.on('data',c=>err+=c);child.on('error',reject);child.on('close',code=>code===0?resolve(out):reject(new Error('Không đọc được mục lục backup: '+err)));
 });
 // pg_dump stores a CREATE SCHEMA public record, but every new PostgreSQL
 // database already has public. Omit only that one record during restoration.
 await fs.writeFile(tocFile,toc.split('\n').filter(line=>!/^\d+;\s+\d+\s+\d+\s+SCHEMA\s+-\s+public\s/.test(line)).join('\n'));
 const cert=path.join(clientTemp,'ca.crt');await fs.writeFile(cert,process.env.DATABASE_CA_CERT,{mode:0o600});
 const env={...process.env,PGHOST:url.hostname,PGPORT:String(url.port||5432),PGUSER:decodeURIComponent(url.username),PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:url.pathname.slice(1),PGSSLMODE:'verify-full',PGSSLROOTCERT:cert};
 await new Promise((resolve,reject)=>{
  const child=spawn(process.env.PG_RESTORE||'pg_restore',['--exit-on-error','--no-owner','--no-acl','--single-transaction','--use-list',tocFile,'--dbname='+url.toString(),'--no-password',path.join(folder,'database.dump')],{env,stdio:['ignore','ignore','pipe']});let err='';child.stderr.on('data',c=>err+=c);child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error('Khôi phục PostgreSQL thất bại: '+err)));
 });
 const validation=await pool.query("SELECT (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE')::int AS tables,(SELECT COUNT(*) FROM public.users)::int AS users,(SELECT COUNT(*) FROM public.files)::int AS files,(SELECT COUNT(*) FROM public.permits)::int AS permits");
 const checks={users:'users',files:'files',permits:'permits'};
 for(const [key,table] of Object.entries(checks))if(manifest.recordCounts?.[table]!=null&&Number(validation.rows[0][key])!==manifest.recordCounts[table])throw new Error('Số hàng sau phục hồi không khớp bản sao');
 console.log(JSON.stringify({success:true,validation:validation.rows[0],duration_ms:Date.now()-Date.parse(manifest.created_at),recovery_point_age_seconds:Math.ceil((Date.now()-Date.parse(manifest.created_at))/1000)}));
}catch(error){
 if(uploaded.length)await storage.storage.from(bucketName).remove(uploaded);
 console.error(error.message);process.exitCode=1;
}finally{await pool.end();await fs.rm(clientTemp,{recursive:true,force:true});}
