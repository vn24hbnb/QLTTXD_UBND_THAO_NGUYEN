import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {computeFileHash} from './backup.js';
const backup=path.resolve(process.argv[2]||'');if(!process.argv[2])throw new Error('Chỉ rõ thư mục bản sao cloud');
const pgBin=process.env.PG_BINDIR||'/opt/homebrew/opt/postgresql@18/bin';const libpq=process.env.PG_LIBPQ_DIR||'/opt/homebrew/opt/libpq/bin';
const root=await fs.mkdtemp(path.join(os.tmpdir(),'qlttxd-pg-recovery-'));const data=path.join(root,'data');let server=false;
function run(executable,args,options={}){return new Promise((resolve,reject)=>{const child=spawn(executable,args,{...options,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);child.on('error',reject);child.on('close',code=>code===0?resolve({stdout,stderr}):reject(new Error(stderr||`${path.basename(executable)} exited ${code}`)));});}
try{
 const manifest=JSON.parse(await fs.readFile(path.join(backup,'manifest.json'),'utf8'));if(manifest.format!=='qlttxd-postgres-backup-v1')throw new Error('Backup không đúng PostgreSQL');
 for(const file of manifest.files){const f=path.join(backup,file.fileName);const stat=await fs.stat(f);if(stat.size!==file.size||await computeFileHash(f)!==file.sha256)throw new Error('SHA-256 backup sai');}
 await run(path.join(pgBin,'initdb'),['--username=postgres','--auth-local=trust','--auth-host=trust','-D',data]);
 await run(path.join(pgBin,'pg_ctl'),['-D',data,'-l',path.join(root,'postgres.log'),'-o','-p 55439 -h 127.0.0.1','start']);server=true;
 await run(path.join(pgBin,'createdb'),['-p','55439','-h','127.0.0.1','-U','postgres','qlttxd_restore']);
 await run(path.join(pgBin,'psql'),['-p','55439','-h','127.0.0.1','-U','postgres','-d','qlttxd_restore','-v','ON_ERROR_STOP=1','-c','CREATE SCHEMA extensions; CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE ROLE qlttxd_backend NOLOGIN; CREATE EXTENSION postgis WITH SCHEMA extensions;']);
 const listing=await run(path.join(libpq,'pg_restore'),['--list',path.join(backup,'database.dump')]);const toc=listing.stdout.split('\n').filter(line=>!/^\d+;\s+\d+\s+\d+\s+SCHEMA\s+-\s+public\s/.test(line)).join('\n');const tocPath=path.join(root,'toc.list');await fs.writeFile(tocPath,toc);
 await run(path.join(libpq,'pg_restore'),['--exit-on-error','--no-owner','--no-acl','--single-transaction','--use-list',tocPath,'-p','55439','-h','127.0.0.1','-U','postgres','-d','qlttxd_restore',path.join(backup,'database.dump')]);
 const checked=await run(path.join(pgBin,'psql'),['-p','55439','-h','127.0.0.1','-U','postgres','-d','qlttxd_restore','-v','ON_ERROR_STOP=1','-At','-F',',','-c',"SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'; SELECT COUNT(*) FROM public.users; SELECT extensions.ST_SRID(extensions.ST_SetSRID(extensions.ST_MakePoint(104.688,20.893),4326));"]);
 const [tables,users,srid]=checked.stdout.trim().split('\n');if(Number(tables)!==13||Number(users)!==(manifest.recordCounts?.users||0)||Number(srid)!==4326)throw new Error(`Khôi phục xong nhưng chưa khớp: tables=${tables}, users=${users}, expectedUsers=${manifest.recordCounts?.users}, srid=${srid}`);
 console.log(JSON.stringify({restore:'PASS',tables:Number(tables),users:Number(users),postgis_srid:Number(srid),integrity_checks:'PostgreSQL completed recovery in a new isolated database',duration:'measured in generated clean ephemeral cluster'}));
}finally{
 if(server)await run(path.join(pgBin,'pg_ctl'),['-D',data,'stop']).catch(()=>{});
 await fs.rm(root,{recursive:true,force:true});
}
