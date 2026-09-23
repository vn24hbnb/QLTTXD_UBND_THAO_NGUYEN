import test from 'node:test';
import assert from 'node:assert/strict';
import qrcodeService from '../src/services/qrcode.js';

test('QRCODE: Tạo ma trận QR Code hợp lệ cho Giấy phép Xây dựng', () => {
  const permitUrl = qrcodeService.getPermitQrUrl('12/GPXD-2026');
  const qr = qrcodeService.createQrMatrix(permitUrl);

  assert.ok(qr.matrix, 'Ma trận QR phải được sinh ra');
  assert.ok(qr.size >= 21, 'Kích thước ma trận tối thiểu từ 21x21');
  assert.ok(qr.version >= 1, 'Phiên bản QR phải >= 1');
  assert.ok(['L', 'M'].includes(qr.level), 'Mức sửa lỗi phải là L hoặc M');
  assert.ok(qr.mask >= 0 && qr.mask <= 7, 'Mặt nạ phải từ 0 đến 7');

  // Kiểm tra 3 mẫu định vị (Finder patterns) ở 3 góc
  // Góc trên trái (0, 0)
  assert.equal(qr.matrix[0][0], 1);
  assert.equal(qr.matrix[3][3], 1);
  assert.equal(qr.matrix[1][1], 0);

  // Góc trên phải (0, N-1)
  assert.equal(qr.matrix[0][qr.size - 1], 1);
  assert.equal(qr.matrix[3][qr.size - 4], 1);

  // Góc dưới trái (N-1, 0)
  assert.equal(qr.matrix[qr.size - 1][0], 1);
  assert.equal(qr.matrix[qr.size - 4][3], 1);
});

test('QRCODE: Xuất chuỗi SVG véc-tơ chuẩn sắc nét', () => {
  const svg = qrcodeService.generateQrSvg('https://qlttxd.thaonguyen.gov.vn/tra-cuu?code=TN-DEMO-9821', {
    size: 240,
    padding: 4
  });

  assert.ok(svg.startsWith('<svg'), 'Đầu ra phải là thẻ mở svg');
  assert.ok(svg.endsWith('</svg>'), 'Đầu ra phải kết thúc bằng thẻ đóng svg');
  assert.ok(svg.includes('viewBox="0 0'), 'Phải chứa thuộc tính viewBox');
  assert.ok(svg.includes('width="240"'), 'Kích thước chiều rộng phải đúng tham số');
  assert.ok(svg.includes('height="240"'), 'Kích thước chiều cao phải đúng tham số');
  assert.ok(svg.includes('shape-rendering="crispEdges"'), 'Phải tối ưu hiển thị điểm ảnh véc-tơ');
  assert.ok(svg.includes('<path d="M'), 'Phải chứa các lệnh vẽ path cho module');
});

test('QRCODE: Xuất Data URI nhúng trực tiếp thẻ ảnh', () => {
  const dataUri = qrcodeService.generateQrDataUri('TN-DEMO-4412');
  assert.ok(dataUri.startsWith('data:image/svg+xml;utf8,'), 'Data URI phải đúng tiền tố SVG');
  assert.ok(dataUri.includes('%3Csvg'), 'Nội dung SVG phải được mã hóa URL an toàn');
});

test('QRCODE: Mã hóa chính xác chuỗi có dấu tiếng Việt UTF-8', () => {
  const vnText = 'Công trình: Phường Thảo Nguyên, Mộc Châu, Sơn La';
  const qr = qrcodeService.createQrMatrix(vnText);
  assert.ok(qr.size >= 25, 'Chuỗi tiếng Việt UTF-8 phải chọn phiên bản phù hợp');
  const svg = qrcodeService.generateQrSvg(vnText);
  assert.ok(svg.length > 500, 'SVG phải có dữ liệu đầy đủ');
});
