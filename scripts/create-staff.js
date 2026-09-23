import fs from 'node:fs';
import crypto from 'node:crypto';
import db,{closeDatabase} from '../src/db/database.js';
import {hashPassword} from '../src/services/auth.js';
const [username,role,passwordFile,totpFile]=process.argv.slice(2);
if(!username||!['admin','coordinator','inspector'].includes(role)||!passwordFile){console.error('Cách dùng: node --env-file=<server.env> scripts/create-staff.js <username> <admin|coordinator|inspector> <password-file> [totp-file]');process.exit(1);}
const password=fs.readFileSync(passwordFile,'utf8').trim();
const totp=totpFile?fs.readFileSync(totpFile,'utf8').trim():null;
if(password.length<16|| (role==='admin'&&!/^[A-Z2-7]{32}$/.test(totp||'')))throw new Error('Mật khẩu cần ít nhất 16 ký tự; quản trị cần khóa TOTP 32 ký tự');
try{
 await db.transaction(async()=>{
  const id=crypto.randomUUID();const now=new Date().toISOString();
  await db.run('INSERT INTO users(id,username,password_hash,full_name,role,totp_secret,is_active,created_at) VALUES(?,?,?,?,?,?,1,?)',[id,username,hashPassword(password),'Cán bộ '+username,role,totp,now]);
  await db.run('INSERT INTO audit_logs(user_id,action,entity_type,entity_id,details,created_at) VALUES(?,?,?,?,?,?)',[id,'PROVISION_STAFF','users',id,JSON.stringify({username,role,source:'operator_cli'}),now]);
 });
 console.log('Đã tạo tài khoản '+username+' với quyền '+role+'.');
}finally{await closeDatabase();}
