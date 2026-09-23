import test from 'node:test';
import assert from 'node:assert';
import dbService from '../src/db/database.js';
import batchImportService from '../src/services/batch_import.js';

test('BATCH IMPORT: Phân tích cú pháp RFC 4180 CSV thuần Node.js', async () => {
  const csv = `Số giấy phép,Chủ hộ,Địa điểm xây dựng,DT đất (m²),Kinh độ,Vĩ độ
"GP-TEST-01","Nguyễn Văn A, Chủ hộ","Tổ 1, Phường Thảo Nguyên",120.5,104.665,20.845,UBND thử nghiệm,Nhà ở
"GP-TEST-02","Trần Thị B","Tổ 2, ""Khu đồi chè""",95.0,104.670,20.840
`;

  const parsed = batchImportService.parseCsv(csv);
  assert.strictEqual(parsed.headers.length, 6);
  assert.strictEqual(parsed.rows.length, 2);
  assert.strictEqual(parsed.rows[0][1], 'Nguyễn Văn A, Chủ hộ');
  assert.strictEqual(parsed.rows[1][2], 'Tổ 2, "Khu đồi chè"');
});

test('BATCH IMPORT: Xem trước và phát hiện lỗi từng dòng (Preview & Validation)', async () => {
  // Tạo 1 giấy phép có sẵn để kiểm tra trùng
  const existingNum = `GP-EXIST-${Date.now()}`;
  const okNum = `GP-OK-${Date.now()}`;
  (await dbService.run(
    `INSERT INTO permits (id, permit_number, issue_date, issuing_authority, owner_name, site_address, construction_type, status, longitude, latitude, created_at, updated_at)
     VALUES (?, ?, '2026-01-01', 'UBND', 'Ai đó', 'Tổ 1', 'Nhà', 'Cần kiểm tra', 104.66, 20.84, '2026-01-01', '2026-01-01')`,
    [`GP-EX-${Date.now()}`, existingNum]
  ));

  const csvContent = `Số giấy phép,Ngày cấp,Chủ hộ,Địa điểm xây dựng,DT xây dựng (m²),Kinh độ,Vĩ độ,Cơ quan cấp,Loại công trình
${okNum},2026-05-10,Nguyễn Văn Đúng,Tổ 1 Thảo Nguyên,120,104.665,20.845,UBND thử nghiệm,Nhà ở
${existingNum},2026-05-11,Trùng Cơ Sở Dữ Liệu,Tổ 2 Thảo Nguyên,100,104.667,20.847,UBND thử nghiệm,Nhà ở
GP-SWAP-01,15/06/2026,Đảo Tọa Độ,Tổ 3 Thảo Nguyên,110,20.845,104.665,UBND thử nghiệm,Nhà ở
GP-NEG-01,2026-06-20,Diện Tích Âm,Tổ 4 Thảo Nguyên,-50,104.668,20.848,UBND thử nghiệm,Nhà ở
GP-DUP-FILE,2026-07-01,Trùng Trong File 1,Tổ 5 Thảo Nguyên,80,104.669,20.849,UBND thử nghiệm,Nhà ở
GP-DUP-FILE,2026-07-02,Trùng Trong File 2,Tổ 5 Thảo Nguyên,85,104.670,20.850,UBND thử nghiệm,Nhà ở
`;

  const preview = (await batchImportService.previewBatch(csvContent));

  assert.strictEqual(preview.success, true);
  assert.strictEqual(preview.totalRows, 6);

  // Dòng 1 hợp lệ
  assert.strictEqual(preview.previewRows[0].isValid, true);
  assert.strictEqual(preview.previewRows[0].data.permit_number, okNum);


  // Dòng 2 trùng CSDL
  assert.strictEqual(preview.previewRows[1].isValid, false);
  assert.ok(preview.previewRows[1].errors.some(e => /đã tồn tại/.test(e.message)));

  // Dòng 3 đảo tọa độ (Lat > 50, Lng < 50)
  assert.strictEqual(preview.previewRows[2].isValid, false);
  assert.ok(preview.previewRows[2].errors.some(e => /tọa độ|vĩ độ/.test(e.message)));

  // Dòng 4 diện tích âm
  assert.strictEqual(preview.previewRows[3].isValid, false);
  assert.ok(preview.previewRows[3].errors.some(e => /diện tích/.test(e.message)));

  // Dòng 6 trùng với dòng 5 trong cùng tệp
  assert.strictEqual(preview.previewRows[5].isValid, false);
  assert.ok(preview.previewRows[5].errors.some(e => /trùng/i.test(e.message)));
});

test('BATCH IMPORT: Ghi nhận chính thức danh sách hợp lệ vào CSDL (Commit Batch)', async () => {
  const pNum = `GP-BATCH-${Date.now()}`;
  const validRows = [
    {
      data: {
        permit_number: pNum,
        issue_date: '2026-06-15',
        issuing_authority: 'UBND thị xã Mộc Châu',
        owner_name: 'Bùi Thị Lan',
        site_address: 'Tổ 6, Phường Thảo Nguyên, Sơn La',
        construction_type: 'Nhà ở riêng lẻ',
        land_area: 150,
        building_area: 100,
        total_floor_area: 250,
        floors_text: '2 tầng',
        confirmed_floors: 2,
        longitude: 104.6642,
        latitude: 20.8415
      }
    }
  ];

  const result = (await batchImportService.commitBatch(validRows, 'usr-admin', 'danh_sach_2026.csv'));
  assert.strictEqual(result.success, true);
  assert.strictEqual(result.importedCount, 1);

  const inserted = (await dbService.get('SELECT * FROM permits WHERE permit_number = ?', [pNum]));
  assert.ok(inserted);
  assert.strictEqual(inserted.owner_name, 'Bùi Thị Lan');
  assert.strictEqual(inserted.status, 'Cần kiểm tra');

  // Kiểm tra bảng import_batches
  const batchLog = (await dbService.get('SELECT * FROM import_batches WHERE id = ?', [result.batchId]));
  assert.ok(batchLog);
  assert.strictEqual(batchLog.filename, 'danh_sach_2026.csv');
  assert.strictEqual(batchLog.valid_rows, 1);
});
