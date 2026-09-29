import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const isolated = await fs.mkdtemp(path.join(os.tmpdir(), 'qlttxd-public-'));
process.env.NODE_ENV = 'test';
process.env.DB_PATH = path.join(isolated, 'test.db');
process.env.UPLOADS_DIR = path.join(isolated, 'uploads');
delete process.env.DATABASE_URL;
delete process.env.SUPABASE_URL;
const { default: db, closeDatabase } = await import('../src/db/database.js');
const { createServer } = await import('../src/server.js');
const { maskContacts } = await import('../src/services/complaints.js');
let server; let base;

before(async () => {
  await db.ready();
  const now = new Date().toISOString();
  const insert = (id, code, step, extra = {}) => db.run(
    `INSERT INTO complaints (id,lookup_code,title,content,location_text,longitude,latitude,is_anonymous,sender_phone,sender_email,status_step,master_complaint_id,created_at,updated_at,version_id)
     VALUES (?,?,?,?,?,?,?,0,?,?,?,?,?,?,1)`,
    [id, code, 'Tiêu đề riêng ' + id, 'Nội dung riêng tư ' + id, extra.address ?? `Tổ 5 ${id}`, 'lng' in extra ? extra.lng : 104.69, 'lat' in extra ? extra.lat : 20.9, '0912345678', 'nguoidan@example.com', step, extra.master ?? null, now, now]);
  for (let step = 0; step <= 5; step++) await insert(`c${step}`, `TN-DEMO-CODE${step}`, step);
  await insert('merged', 'TN-DEMO-MERGED', 5, { master: 'c5' });
  await insert('nocoord', 'TN-DEMO-NOCOORD', 5, { lng: null, lat: null });
  await insert('phone', 'TN-DEMO-PHONE', 4, { address: 'Nhà ông A, liên hệ 0912 345 678 hoặc a.b@mail.vn' });
  await db.run(`INSERT INTO permits (id,permit_number,issue_date,issuing_authority,owner_name,owner_address,construction_type,site_address,land_area,building_area,total_floor_area,floors_text,confirmed_floors,building_height,red_line_setback,construction_boundary,setback_text,ground_elevation,building_density,land_use_ratio,exterior_color,design_by,land_lot,land_use_cert,status,current_stage,version_id,is_public,longitude,latitude,created_at,updated_at)
    VALUES ('pub','GP-PUB','2026-09-01','UBND','CHỦ HỘ RIÊNG TƯ','ĐỊA CHỈ NHÀ RIÊNG','Nhà ở riêng lẻ','Tổ 3',120,80,240,'3 tầng',3,11.5,'Lùi 3 m so với đường đỏ','Cách mép đường 6 m','2 m',0.4,65,2.1,'Trắng','ĐƠN VỊ TK','THỬA 12','GCN 999','Cần kiểm tra',1,1,1,104.7,20.9,?,?)`, [now, now]);
  server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  await new Promise(resolve => server.close(resolve));
  await closeDatabase();
  await fs.rm(isolated, { recursive: true, force: true });
});

test('CÔNG KHAI: bản đồ phản ánh chỉ có phản ánh đã xác minh, không lộ danh tính hay mã tra cứu', async () => {
  const response = await fetch(`${base}/api/public/complaints/map`);
  assert.equal(response.status, 200);
  const body = await response.text();
  const pins = JSON.parse(body).data;
  assert.deepEqual(pins.map(p => p.location_text).sort(), ['Nhà ông A, liên hệ [đã ẩn] hoặc [đã ẩn]', 'Tổ 5 c4', 'Tổ 5 c5']);
  for (const p of pins) assert.deepEqual(Object.keys(p).sort(), ['latitude', 'location_text', 'longitude', 'status_label', 'updated_at']);
  for (const secret of ['TN-DEMO', '0912', 'nguoidan@', 'Nội dung riêng tư', 'Tiêu đề riêng', 'sender_', 'lookup_code']) assert.ok(!body.includes(secret), `Không được lộ ${secret}`);
  assert.deepEqual([...new Set(pins.map(p => p.status_label))].sort(), ['Đang xử lý', 'Đã phản hồi']);
});

test('CÔNG KHAI: phản ánh mới gửi hoặc mới tiếp nhận (bước 0–3) không xuất hiện trên bản đồ', async () => {
  await db.run('UPDATE complaints SET status_step = 3 WHERE id IN (\'c4\',\'c5\',\'phone\')');
  const pins = (await (await fetch(`${base}/api/public/complaints/map`)).json()).data;
  assert.equal(pins.length, 0);
});

test('CÔNG KHAI: thông tin giấy phép chỉ gồm chỉ giới, số tầng, diện tích, chiều cao và định danh công trình', async () => {
  const list = (await (await fetch(`${base}/api/public/permits`)).json()).data;
  const one = (await (await fetch(`${base}/api/public/permits/pub`)).json()).data;
  const allowed = ['id', 'permit_number', 'site_address', 'construction_type', 'building_area', 'total_floor_area', 'floors_text', 'confirmed_floors', 'building_height', 'red_line_setback', 'construction_boundary', 'setback_text', 'status', 'current_stage', 'longitude', 'latitude', 'updated_at'];
  for (const permit of [list[0], one]) {
    assert.ok(permit.red_line_setback && permit.construction_boundary && permit.building_height && permit.building_area && permit.confirmed_floors);
    assert.deepEqual(Object.keys(permit).filter(k => !allowed.includes(k)), []);
  }
  const text = JSON.stringify([list, one]);
  for (const secret of ['CHỦ HỘ RIÊNG TƯ', 'ĐỊA CHỈ NHÀ RIÊNG', 'THỬA 12', 'GCN 999', 'ĐƠN VỊ TK']) assert.ok(!text.includes(secret));
});

test('maskContacts che số điện thoại và email nhưng giữ địa chỉ thường', () => {
  assert.equal(maskContacts('Tổ 5, số nhà 12/3, đường Lê Lợi'), 'Tổ 5, số nhà 12/3, đường Lê Lợi');
  assert.equal(maskContacts('gọi +84 912-345-678'), 'gọi [đã ẩn]');
  assert.equal(maskContacts('x@y.vn'), '[đã ẩn]');
});
