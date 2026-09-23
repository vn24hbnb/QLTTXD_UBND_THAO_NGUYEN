# QUY TẮC DỰ ÁN & HƯỚNG DẪN KỸ THUẬT (AGENTS.MD)
## Dự án Quản lý Trật tự Xây dựng Phường Thảo Nguyên, Tỉnh Sơn La

Tài liệu này xác lập các nguyên tắc bắt buộc khi lập trình, kiểm thử và vận hành hệ thống phần mềm Quản lý trật tự xây dựng phường Thảo Nguyên theo kế hoạch mốc A (thử nghiệm tháng 10/2026).

---

### 1. Dữ liệu Được phép & Hạn chế
- **Dữ liệu công khai**: Số giấy phép, loại công trình, địa chỉ công trình (số nhà/tổ), tọa độ vị trí công trình, trạng thái công trình, số tầng, diện tích xây dựng, khoảng lùi đã duyệt.
- **Dữ liệu tuyệt đối bảo mật (PII - Không trả về qua Public API)**:
  - Họ tên, số CCCD/CMND, số điện thoại, email, địa chỉ cư trú của chủ hộ/chủ đầu tư/người xin cấp phép.
  - Danh tính và số điện thoại của người phản ánh (trừ khi cán bộ tiếp nhận có thẩm quyền xem trong phiên nghiệp vụ nội bộ).
  - Phản ánh của người dân khi chưa được cán bộ xác minh/duyệt không xuất hiện trên bản đồ công khai.
- **Dữ liệu bản đồ & GIS**: Sử dụng ranh giới hành chính chuẩn từ tệp GeoJSON của 4 xã/phường (Thảo Nguyên `03982`, Mộc Châu, Mộc Sơn, Vân Sơn). Tọa độ chuẩn WGS-84 `[kinh độ, vĩ độ]`.

---

### 2. Kiến trúc & Công nghệ Chuẩn mực
- **Ngôn ngữ**: Node.js v24 (ESM: `import/export`).
- **Lưu trữ CSDL**: PostgreSQL/PostGIS cho môi trường máy chủ sản xuất; SQLite có lớp tương thích không gian (`node:sqlite`) cho môi trường phát triển cục bộ và kiểm thử tự động, đảm bảo giao dịch ACID, ràng buộc khóa ngoại, chống ghi đè phiên bản (`version_id`).
- **REST API**: Trả về dữ liệu chuẩn JSON tiếng Việt rõ ràng, mã trạng thái HTTP chuẩn (200, 201, 400, 401, 403, 404, 409, 429, 500).
- **Idempotency**: Mọi thao tác ghi nhận quan trọng (gửi phản ánh, lập phiếu kiểm tra, nộp kết quả) phải hỗ trợ khóa chống gửi lặp `Idempotency-Key` để bảo đảm an toàn khi mạng chập chờn.
- **Kiểm tra đầu vào**: Xác thực dữ liệu nghiêm ngặt phía máy chủ (Server-side validation), phòng chống tấn công XSS, SQL Injection, CSV Formula Injection (các trường bắt đầu bằng `=`, `+`, `-`, `@` phải được bọc thoát hiểm an toàn).

---

### 3. Phân quyền & Quản lý Phiên (RBAC)
- **Người dân (Public/Citizen)**:
  - Chỉ xem bản đồ công khai và thông tin đã duyệt.
  - Gửi phản ánh (ẩn danh hoặc có mã tra cứu bí mật ngẫu nhiên `TN-DEMO-XXXX`).
  - Tra cứu phản ánh bằng mã bảo mật, không được xem phản ánh của người khác.
- **Cán bộ tiếp nhận**: Tiếp nhận phản ánh, sàng lọc sơ bộ, chuyển giao phân công.
- **Cán bộ kiểm tra**: Thực hiện kiểm tra 4 mốc hiện trường, nhập chỉ tiêu thực tế, tải ảnh hiện trường, lập dự thảo phiếu kiểm tra.
- **Người điều phối / Lãnh đạo**: Duyệt kết quả kiểm tra, duyệt phản hồi người dân, công bố thông tin, xem toàn bộ báo cáo tổng hợp.
- **Quản trị hệ thống**: Vận hành sao lưu, phục hồi dữ liệu, kiểm tra nhật ký kiểm toán (Audit Logs).

---

### 4. Quy tắc Kiểm thử & Nghiệm thu
- **Tiêu chí Hoàn thành (Definition of Done)**:
  1. 100% ca kiểm thử trong `tests/` phải vượt qua (Zero fail).
  2. Không còn bất kỳ lỗi nào thuộc cấp độ P0 (mất/rò rỉ dữ liệu, sai quyền) hoặc P1 (sai lệch hồ sơ, chặn luồng cốt lõi).
  3. Kịch bản sao lưu và phục hồi phải được kiểm chứng phục hồi thành công trên môi trường sạch với RPO $\le$ 24h, RTO $\le$ 1 ngày làm việc.
  4. Mọi thay đổi cấu trúc bảng hoặc dữ liệu đều phải có tệp di chuyển (migration/seed) và nhật ký thay đổi.
