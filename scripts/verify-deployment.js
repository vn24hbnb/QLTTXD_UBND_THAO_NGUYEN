import crypto from 'node:crypto';
const base=(process.env.VERIFY_DEPLOYMENT_URL||'https://qlttxd-thao-nguyen.vercel.app').replace(/\/$/,'');
const username=process.env.VERIFY_ADMIN_USERNAME||'vn24hbnb';
const password=process.env.VERIFY_ADMIN_PASSWORD;const secret=process.env.VERIFY_ADMIN_TOTP;
if(!password||!secret)throw new Error('Cần cung cấp tài khoản production từ tệp local an toàn');
function totp(){const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits='';for(const c of secret)bits+=alphabet.indexOf(c).toString(2).padStart(5,'0');const bytes=[];for(let i=0;i+8<=bits.length;i+=8)bytes.push(parseInt(bits.slice(i,i+8),2));const key=Buffer.from(bytes);const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)));const h=crypto.createHmac('sha1',key).update(counter).digest();const offset=h.at(-1)&15;return String((h.readUInt32BE(offset)&0x7fffffff)%1e6).padStart(6,'0');}
const headers={origin:base,'content-type':'application/json'};
const health=await fetch(base+'/api/health');if(!health.ok)throw new Error('Health check thất bại');
const login=await fetch(base+'/api/internal/auth/login',{method:'POST',headers,body:JSON.stringify({username,password,totp_token:totp()})});
if(!login.ok)throw new Error('Đăng nhập production thất bại với HTTP '+login.status);
const user=(await login.json()).user;if(user.username!==username||user.role!=='admin')throw new Error('API trả sai vai trò phiên đăng nhập');
const cookie=login.headers.getSetCookie().find(x=>x.startsWith('session_id='));if(!cookie||!/httponly/i.test(cookie)||!/secure/i.test(cookie)||!/samesite=strict/i.test(cookie))throw new Error('Cookie phiên chưa đủ thuộc tính bảo mật');
const sessionHeaders={cookie:cookie.split(';',1)[0]};
const me=await fetch(base+'/api/internal/auth/me',{headers:sessionHeaders});if(!me.ok||((await me.json()).user.role!=='admin'))throw new Error('Kiểm tra phiên cán bộ thất bại');
const permits=await fetch(base+'/api/internal/permits',{headers:sessionHeaders});if(!permits.ok)throw new Error('API nội bộ thất bại');
const count=(await permits.json()).data.length;
const logout=await fetch(base+'/api/internal/auth/logout',{method:'POST',headers:{...sessionHeaders,origin:base}});if(!logout.ok)throw new Error('Đăng xuất production thất bại');
const after=await fetch(base+'/api/internal/auth/me',{headers:sessionHeaders});if(after.ok)throw new Error('Phiên chưa bị thu hồi sau đăng xuất');
console.log(JSON.stringify({health:'PASS',login:'PASS',session:'PASS',internal_permits:count,logout:'PASS'}));
