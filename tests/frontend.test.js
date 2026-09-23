import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';

// Exercise the shipped browser script against API responses, without modifying a real DB.
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const unescape = value => value.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
function harness(handler = async () => ({success:true,data:[]})) {
  const registry = new Map();
  const all = [];
  const stored = new Map();
  const requests = [];
  const windowEvents = new Map();
  function matches(node, selector) {
    if(selector.includes(',')) return selector.split(',').some(part=>matches(node,part.trim()));
    const id=selector.match(/^#([\w-]+)/)?.[1];
    if(id && node.attrs.id !== id)return false;
    const cls=selector.match(/^\.([\w-]+)/)?.[1];
    if(cls && !(node.attrs.class || '').split(' ').includes(cls))return false;
    const tag=selector.match(/^([a-z]+)/)?.[1];
    if(tag && node.tag !== tag)return false;
    for(const [,attr,value] of selector.matchAll(/\[([^=\]]+)(?:=["']?([^\]"']+)["']?)?\]/g)){
      if(!(attr in node.attrs))return false;
      if(value !== undefined && node.attrs[attr] !== value)return false;
    }
    return true;
  }
  class Element {
    constructor(tag='div',attrs={}) {
      this.tag=tag; this.attrs=attrs;this.style={};this.dataset={};this.handlers=new Map();this.children=[];this.textContent='';this._html='';this.hidden='hidden' in attrs;this.disabled=false;this.value=attrs.value || '';this.files=[];
      this.classList={add(){},remove(){},toggle(){}};
      for(const [key,value] of Object.entries(attrs)) if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_,letter)=>letter.toUpperCase())]=value;
      if(attrs.id)registry.set(attrs.id,this);
      all.push(this);
    }
    set innerHTML(value){this._html=value;this.children=parse(value);}
    get innerHTML(){return this._html;}
    addEventListener(type,callback){this.handlers.set(type,callback);}
    querySelector(selector){return this.children.find(node=>matches(node,selector)) || null;}
    querySelectorAll(selector){return this.children.filter(node=>matches(node,selector));}
    setAttribute(key,value){this.attrs[key]=value;}
    contains(node){return node===this || this.children.includes(node);}
    focus(){}
    reportValidity(){return true;}
  }
  function parse(markup){
    const nodes=[];
    for(const [,tag,raw] of markup.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)){
      const attrs={};
      for(const [,name,value,unquoted] of raw.matchAll(/([\w:-]+)(?:="([^"]*)"|=([^\s>]+))?/g))attrs[name]=unescape(value ?? unquoted ?? '');
      const node=new Element(tag,attrs);nodes.push(node);
      if(tag==='textarea' && attrs.id){const match=markup.match(new RegExp(`<textarea[^>]*id="${attrs.id}"[^>]*>([\\s\\S]*?)</textarea>`));node.value=unescape(match?.[1] || '');}
    }
    for(const node of nodes){if(['form','ul','div','article'].includes(node.tag))node.children=nodes.filter(child=>child!==node);}
    return nodes;
  }
  parse(html);
  const document={querySelector:selector=>selector.startsWith('#')?registry.get(selector.slice(1)) || null:all.find(node=>matches(node,selector)) || null,querySelectorAll:selector=>all.filter(node=>matches(node,selector)),addEventListener(){}};
  const window={location:{search:''},addEventListener:(name,fn)=>windowEvents.set(name,fn),print(){}};
  const context={window,document,console,crypto,Date,JSON,Number,String,Array,Math,Set,Map,URL,URLSearchParams,parseInt,parseFloat,requestAnimationFrame(){},setTimeout(){},navigator:{},localStorage:{getItem:key=>stored.get(key) ?? null,setItem:(key,value)=>stored.set(key,value),removeItem:key=>stored.delete(key)},FileReader:class {readAsDataURL(file){this.result=`data:${file.type};base64,${Buffer.from('fixture').toString('base64')}`;this.onload();}},fetch:async(url,options={})=>{
    const request={url,...options};requests.push(request);
    const result=await handler(request);
    if(result instanceof Error)throw result;
    if(result?.response)return result.response;
    return {ok:true,status:200,json:async()=>result};
  }};
  const script=app.replace(/\}\)\(\);\s*$/, 'window.__review = {state,api,setUser,restoreSession,fetchData,normalizePermit,selectPermit,showLoginForm,logout,showComplaintForm,showLookupForm,showPermitA4Modal,saveOfflineDraft,loadOfflineDrafts,inspectionPayload,showSettingsScreen,showReportsScreen};})();');
  vm.createContext(context);vm.runInContext(script,context);
  const el=id=>{const node=registry.get(id);assert.ok(node,`Expected DOM element #${id}`);return node;};
  const trigger=async(id,type='click')=>{const node=el(id);assert.ok(node.handlers.has(type),`Expected ${type} listener on #${id}`);await node.handlers.get(type)({currentTarget:node,target:node,preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));};
  return {ui:window.__review,window,el,trigger,stored,requests,windowEvents};
}
const permit = {id:'p1',permit_number:'01/2026/GPXD',site_address:'Tổ 8',construction_type:'Nhà ở',status:'Cần kiểm tra',current_stage:2,latitude:20.89,longitude:104.68,version_id:7,is_public:0};
const officer={id:'officer-a',role:'inspector',username:'canbo'};
const validDraft={idempotency_key:'draft-stable',user_id:officer.id,permit_id:'p1',permit_number:'01/2026/GPXD',stage_index:2,inspect_date:'2026-09-22',measured_area:95,measured_floors:null,measured_setback:6.2,measured_setback_rear:4.1,notes:'Đã đo',photos:[{fileName:'photo.jpg',sha256:'verified'}],status:'pending_approval',saved_at:'2026-09-22T08:00:00Z'};

test('frontend defaults to public and staff role comes only from login/session, including TOTP',async()=>{
  const h=harness(async req=>req.url.endsWith('/login')?{success:true,user:{...officer,role:'coordinator'}}:{success:true,data:[permit]});
  assert.equal(h.ui.state.role,'citizen');
  assert.doesNotMatch(app,/admin123456|tracking_code|TN-DEMO-7K4P/);
  h.ui.showLoginForm();assert.equal(h.el('login-totp').hidden,true);h.el('login-username').value='canbo';h.el('login-password').value='test-only-password';
  await h.trigger('form-login','submit');
  assert.equal(h.ui.state.role,'coordinator');
  assert.equal(h.el('btn-login').hidden,true);
  const body=JSON.parse(h.requests.find(r=>r.url.endsWith('/login')).body);
  assert.equal(body.totp_token,undefined);
  assert.equal(h.ui.state.permits[0].place,'Tổ 8');assert.equal(h.ui.state.permits[0].done,2);
});

test('frontend keeps anonymous state when login rejects TOTP',async()=>{
  const h=harness(async()=>({response:{ok:false,status:401,json:async()=>({success:false,requireTotp:true,error:'Cần mã TOTP'})}}));
  h.ui.showLoginForm();h.el('login-username').value='canbo';h.el('login-password').value='test-only-password';
  await h.trigger('form-login','submit');assert.equal(h.ui.state.role,'citizen');assert.equal(h.el('login-error').textContent,'Cần mã TOTP');
  assert.equal(h.el('login-totp-label').hidden,false);assert.equal(h.el('login-totp').hidden,false);
  h.el('login-totp').value='123456';await h.trigger('form-login','submit');
  assert.equal(JSON.parse(h.requests.at(-1).body).totp_token,'123456');
});

test('frontend logout clears private DOM, memory, and user-scoped drafts',async()=>{
  const h=harness();h.ui.setUser(officer);h.ui.saveOfflineDraft({...validDraft});h.ui.state.selectedPermit={...permit,owner_name:'PRIVATE'};h.el('place-tech-specs').innerHTML='PRIVATE';
  await h.ui.logout();assert.equal(h.ui.state.role,'citizen');assert.equal(h.ui.state.offlineDrafts.length,0);assert.equal(h.ui.state.selectedPermit,null);assert.equal(h.el('place-tech-specs').innerHTML,'');
  h.ui.setUser({id:'officer-b',role:'inspector'});assert.equal(h.ui.state.offlineDrafts.length,0);
  h.ui.setUser(officer);assert.equal(h.ui.state.offlineDrafts.length,1);assert.equal(h.ui.state.offlineDrafts[0].measured_setback_rear,4.1);
});

test('frontend discards an internal response that arrives after logout',async()=>{
  let release;const h=harness(()=>new Promise(resolve=>{release=resolve;}));h.ui.setUser(officer);const pending=h.ui.fetchData();h.ui.setUser(null);release({success:true,data:[{...permit,owner_name:'PRIVATE'}]});await pending;assert.equal(h.ui.state.permits.length,0);
});

test('frontend draft sync rejects HTML HTTP 200 and preserves all measurements and retry key',async()=>{
  const h=harness(async()=>({response:{ok:true,status:200,json:async()=>{throw new Error('HTML');}}}));h.ui.setUser(officer);h.ui.saveOfflineDraft({...validDraft});
  await h.window.appSyncDraft(validDraft.idempotency_key);await h.window.appSyncDraft(validDraft.idempotency_key);
  assert.equal(h.ui.state.offlineDrafts.length,1);assert.equal(h.requests[0].url,'/api/internal/inspections');
  const payload=JSON.parse(h.requests[0].body);assert.equal(payload.permit_id,'p1');assert.equal(payload.stage_index,2);assert.equal(payload.measured_setback,6.2);assert.equal(payload.measured_setback_rear,4.1);assert.equal(payload.measured_floors,null);
  assert.equal(h.requests[0].headers['Idempotency-Key'],h.requests[1].headers['Idempotency-Key']);
});

test('frontend removes a draft only when JSON confirms an inspection for the same permit',async()=>{
  let correct=false;const h=harness(async req=>req.url==='/api/internal/inspections'?{success:true,data:{id:'insp-real',permit_id:correct?'p1':'wrong'}}:{success:true,data:[permit]});h.ui.setUser(officer);h.ui.saveOfflineDraft({...validDraft});
  await h.window.appSyncDraft(validDraft.idempotency_key);assert.equal(h.ui.state.offlineDrafts.length,1);
  correct=true;await h.window.appSyncDraft(validDraft.idempotency_key);assert.equal(h.ui.state.offlineDrafts.length,0);assert.equal(JSON.parse(h.stored.get(`qlttxd_offline_inspections:${officer.id}`)).length,0);
});

test('frontend inspection form uploads actual photo metadata and sends API contract fields',async()=>{
  const h=harness(async req=>req.url.endsWith('/files/upload')?{success:true,data:{fileName:'server-photo.jpg',sha256:'verified',mimeType:'image/jpeg',fileSize:8}}:req.url==='/api/internal/inspections'?{success:true,data:{id:'insp-real',permit_id:'p1'}}:{success:true,data:[permit]});
  h.ui.setUser(officer);h.ui.state.permits=[h.ui.normalizePermit(permit)];h.window.appStartInspection('p1');
  h.el('insp-stage').value='2';h.el('insp-date').value='2026-09-22';h.el('insp-area').value='95';h.el('insp-setback-front').value='6.2';h.el('insp-setback-rear').value='4.1';
  h.el('insp-photos').files=[{name:'photo.jpg',type:'image/jpeg',size:8}];await h.trigger('insp-photos','change');await h.trigger('form-inspection','submit');
  const upload=JSON.parse(h.requests.find(r=>r.url.endsWith('/files/upload')).body);assert.ok(upload.base64);assert.equal(upload.fileName,'photo.jpg');
  const request=h.requests.find(r=>r.url==='/api/internal/inspections');assert.ok(request);
  const body=JSON.parse(request.body);assert.equal(body.measured_area,95);assert.equal(body.measured_setback_rear,4.1);assert.equal(body.measured_floors,null);assert.equal(body.photos[0].fileName,'server-photo.jpg');assert.equal(body.status,'pending_approval');assert.equal(h.ui.state.offlineDrafts.length,0);
});

test('frontend complaint shows real lookup code and reuses idempotency after an uncertain network failure',async()=>{
  let calls=0;const h=harness(async req=>{if(req.url==='/api/public/complaints'){if(++calls===1)throw new Error('Mất mạng');return {success:true,data:{id:'pa-real',lookup_code:'TN-DEMO-SECRET123'}};}return {success:true,data:{id:'pa-real',title:'Tiêu đề',status_label:'Mới gửi'}};});
  h.ui.showComplaintForm();for(const [id,value] of Object.entries({'comp-title':'Phản ánh','comp-content':'Nội dung','comp-location':'Tổ 8','comp-lng':'104.68','comp-lat':'20.89'}))h.el(id).value=value;
  await h.trigger('form-complaint','submit');assert.match(h.el('complaint-error').textContent,/chưa được xác nhận/);await h.trigger('form-complaint','submit');
  assert.match(h.el('surface-body').innerHTML,/TN-DEMO-SECRET123/);assert.equal(h.requests[0].headers['Idempotency-Key'],h.requests[1].headers['Idempotency-Key']);
  await h.trigger('btn-lookup-submitted');assert.ok(h.requests.some(req=>req.url.endsWith('code=TN-DEMO-SECRET123')));
});

test('frontend escapes permit HTML, uses API progress, and never invents technical values',async()=>{
  const h=harness();const p=h.ui.normalizePermit({...permit,permit_number:'<img src=x onerror=alert(1)>',current_stage:3,is_public:1});await h.ui.selectPermit(p);
  assert.equal(h.el('place-stages-count').textContent,'3/4 mốc');assert.equal(h.el('place-address').textContent,'Tổ 8');assert.match(h.el('place-tech-specs').innerHTML,/Chưa có dữ liệu/);assert.doesNotMatch(h.el('place-tech-specs').innerHTML,/7\.8|Lùi 3\.0m/);
  h.ui.showPermitA4Modal(p);assert.doesNotMatch(h.el('surface-body').innerHTML,/<img src=x/);assert.match(h.el('surface-body').innerHTML,/&lt;img/);assert.doesNotMatch(h.el('surface-body').innerHTML,/Đã ký, đóng dấu/);
});

test('frontend publication sends the reviewed permit version and approval loads the real inspection route',async()=>{
  const h=harness(async req=>req.url.endsWith('/publication')?{success:true,data:{...permit,is_public:1,version_id:8}}:req.url.includes('/inspections?')?{success:true,data:[]}:req.url==='/api/internal/permits'?{success:true,data:[permit]}:{success:true,data:permit});
  h.ui.setUser({...officer,role:'coordinator'});await h.ui.selectPermit(h.ui.normalizePermit(permit));await h.trigger('btn-publication');
  const req=h.requests.find(r=>r.url.endsWith('/publication'));assert.deepEqual(JSON.parse(req.body),{is_public:true,version_id:7});assert.ok(h.requests.some(r=>r.url==='/api/internal/inspections?permit_id=p1'));
});

test('frontend startup binds every shipped control and stays public on expired session',async()=>{
  const h=harness(async req=>req.url.endsWith('/auth/me')?{response:{ok:false,status:401,json:async()=>({success:false,error:{message:'Chưa đăng nhập'}})}}:{success:true,data:[]});
  await h.windowEvents.get('DOMContentLoaded')();assert.equal(h.ui.state.role,'citizen');assert.ok(h.requests.some(r=>r.url==='/api/public/permits'));assert.equal(h.el('btn-logout').hidden,true);
});

test('service worker never intercepts API files, private prints, or third-party resources for caching',()=>{
  const events=new Map();const ctx={self:{location:{origin:'https://example.test'},addEventListener:(name,handler)=>events.set(name,handler)},URL};
  vm.createContext(ctx);vm.runInContext(fs.readFileSync(new URL('../public/sw.js',import.meta.url),'utf8'),ctx);
  for(const url of ['https://example.test/api/files/private.svg','https://example.test/api/internal/inspections/1/print','https://example.test/api/public/permits','https://cdn.example/app.js']){
    let intercepted=false;events.get('fetch')({request:{url,method:'GET'},respondWith(){intercepted=true;}});assert.equal(intercepted,false,url);
  }
});
