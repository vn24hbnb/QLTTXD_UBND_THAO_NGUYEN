import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import permits from '../src/services/permits.js';
import batch from '../src/services/batch_import.js';
import dbService from '../src/db/database.js';

const base = n => ({ permit_number: `PUB-${crypto.randomUUID()}`, issue_date: '2026-09-01', issuing_authority: 'UBND', owner_name: 'Chủ hộ', construction_type: 'Nhà ở', site_address: `Tổ ${n}`, building_area: 90, longitude: 104.7, latitude: 20.9 });
const publicIds = async () => new Set((await permits.getPublicPermits({ limit: 1000 })).map(p => p.id));

test('PUBLISH: hồ sơ mới mặc định nội bộ; tùy chọn công bố ngay chỉ có hiệu lực khi có vị trí', async () => {
  const internal = await permits.createPermit(base(1), 'usr-admin');
  const published = await permits.createPermit(base(2), 'usr-admin', null, { publish: true });
  const noLocation = await permits.createPermit({ ...base(3), longitude: null, latitude: null }, 'usr-admin', null, { publish: true });
  const visible = await publicIds();
  assert.ok(!visible.has(internal.id));
  assert.ok(visible.has(published.id));
  assert.ok(!visible.has(noLocation.id), 'Chưa có vị trí thì không được công bố');
});

test('PUBLISH: công bố hàng loạt chỉ áp dụng cho hồ sơ nội bộ có vị trí, có lịch sử và nhật ký', async () => {
  const a = await permits.createPermit(base(4), 'usr-admin');
  const b = await permits.createPermit(base(5), 'usr-coordinator');
  const noLocation = await permits.createPermit({ ...base(6), longitude: null, latitude: null }, 'usr-admin');
  const result = await permits.publishPermitsBulk('usr-coordinator');
  assert.ok(result.published >= 2);
  assert.ok(result.skippedNoLocation >= 1);
  const visible = await publicIds();
  assert.ok(visible.has(a.id) && visible.has(b.id));
  assert.ok(!visible.has(noLocation.id));
  assert.equal((await permits.getPermitById(a.id, true)).version_id, 2);
  assert.ok(await dbService.get("SELECT 1 AS x FROM permit_history WHERE permit_id = ? AND change_reason = 'Công bố hàng loạt'", [a.id]));
  assert.ok(await dbService.get("SELECT 1 AS x FROM audit_logs WHERE action = 'PUBLISH_PERMIT' AND entity_id = ? AND details LIKE '%bulk%'", [a.id]));
  assert.equal((await permits.publishPermitsBulk('usr-admin')).published, 0, 'Chạy lại không công bố thêm');
});

test('PUBLISH: chỉ điều phối/quản trị được công bố hàng loạt', async () => {
  for (const user of ['usr-inspector', 'usr-citizen']) await assert.rejects(permits.publishPermitsBulk(user), /quyền/);
});

test('PUBLISH: nhập CSV có thể công bố ngay, mặc định vẫn nội bộ', async () => {
  const rows = [base(7), base(8)];
  const internal = await batch.commitBatch([rows[0]], 'usr-admin', 'a.csv');
  const live = await batch.commitBatch([rows[1]], 'usr-admin', 'b.csv', null, { publish: true });
  const visible = await publicIds();
  assert.ok(!visible.has(internal.permits[0].id));
  assert.ok(visible.has(live.permits[0].id));
});
