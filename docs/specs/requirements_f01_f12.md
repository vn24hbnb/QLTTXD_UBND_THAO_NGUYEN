# ĐẶC TẢ YÊU CẦU CHỨC NĂNG F01 - F12
## Dự án Quản lý Trật tự Xây dựng Phường Thảo Nguyên (Mốc A - Tháng 10/2026)

### F01: Tài khoản Cán bộ và Phân quyền (RBAC)
- Xác thực đăng nhập cán bộ an toàn qua Session Cookie (HttpOnly, Secure, SameSite=Strict).
- Hỗ trợ mã TOTP (Time-based One-Time Password) xác thực hai bước.
- Thu hồi phiên tức thời khi phát hiện vi phạm hoặc đăng xuất.
- Phân chia vai trò tối thiểu 3 nhóm nghiệp vụ: Tiếp nhận, Kiểm tra thực địa, Lãnh đạo/Duyệt.

### F02: Bản đồ, Tìm kiếm và Danh sách Công trình
- Bản đồ trực quan thể hiện địa giới hành chính phường Thảo Nguyên và các xã lân cận.
- Tìm kiếm theo số giấy phép, địa chỉ, tên tổ dân phố.
- Bộ lọc trạng thái: "Tất cả", "Cần kiểm tra", "Đang thi công", "Đã hoàn thành".
- Hiển thị danh sách kết hợp bản đồ tương tác (Mini panel xem nhanh).

### F03: Hồ sơ Giấy phép và Phiên bản Hóa
- Quản lý đầy đủ các trường chỉ tiêu theo Thông tư 34/2026/TT-BXD:
  - Diện tích đất, diện tích xây dựng, tổng diện tích sàn, hệ số sử dụng đất, số tầng nguyên văn, số tầng cao xác nhận, khoảng lùi/chỉ giới.
- Phiên bản hóa hồ sơ: khi điều chỉnh/gia hạn, tạo phiên bản mới có ngày hiệu lực và liên kết tệp nguồn, không xóa đè bản cũ.

### F04: Vị trí và Hình học Công trình (GIS)
- Tọa độ điểm công trình WGS84 `[lng, lat]` gắn với địa bàn phường.
- Ranh giới địa phương từ GeoJSON chuẩn.
- Công cụ đo khoảng cách (m), đo diện tích (m²), phác thảo ranh tham khảo.

### F05: Bản đồ Công khai cho Người dân
- Chỉ xuất bản các trường trong danh sách cho phép (Whitelisted): số GPXD, địa điểm, loại công trình, trạng thái, tiến độ các mốc.
- Ẩn hoàn toàn thông tin cá nhân: chủ đầu tư, SĐT, số CCCD, phản ánh chưa duyệt.

### F06: Phản ánh của Người dân và Tiếp nhận
- Luồng gửi phản ánh 3-4 bước: Chọn vị trí -> Mô tả & ảnh -> Chọn hình thức (Ẩn danh hoặc Mã tra cứu riêng) -> Xem lại & Gửi.
- Tự động sinh mã tra cứu bảo mật ngẫu nhiên (VD: `TN-DEMO-7K4P`).
- Quy trình tiếp nhận: Mới gửi -> Đã tiếp nhận -> Đã phân công -> Đang kiểm tra -> Chờ duyệt -> Đã phản hồi (có thể Mở lại).

### F07: Kiểm tra Hiện trường và Đo đạc 4 Mốc
- 4 mốc chuẩn:
  1. Trước khi đào móng
  2. Xong phần móng tầng 1
  3. Đổ mái tầng 1
  4. Hoàn thành công trình
- Đối chiếu chỉ tiêu thực tế với GPXD (diện tích, khoảng lùi, số tầng).
- Tải ảnh hiện trường (tối đa 5 ảnh, định dạng JPEG/PNG, kiểm tra mã SHA-256).

### F08: Biên bản và Phiếu In Kiểm tra
- Tự động tạo phiếu ghi nhận kiểm tra hiện trường định dạng chuẩn HTML sẵn sàng in ấn/xuất tài liệu.
- Đóng băng dữ liệu tại thời điểm lập, có nhãn thử nghiệm mốc A.

### F09: Công việc và Thống kê Báo cáo
- Danh mục công việc: Cần kiểm tra, Chờ duyệt kết quả, Phản ánh mới.
- Báo cáo số lượng công trình theo từng mốc.
- Xuất dữ liệu CSV an toàn chống Formula Injection (loại bỏ ký tự điều khiển).

### F10: Nhật ký Kiểm toán và Vận hành (Audit Log)
- Ghi nhận mọi thao tác thay đổi: người dùng, thời điểm (UTC), hành động, thực thể, dữ liệu trước/sau.
- Kịch bản sao lưu và phục hồi dữ liệu định kỳ, bảo đảm RPO $\le$ 24h, RTO $\le$ 1 ngày.

### F11: Chống Mất Dữ liệu và Idempotency
- Hỗ trợ khóa Idempotency Key cho API gửi dữ liệu, ngăn tạo bản ghi trùng lặp khi mất kết nối mạng và gửi lại.
- Lưu nháp cục bộ an toàn khi đang kiểm tra hiện trường.

### F12: Nhập và Đối soát Dữ liệu theo Lô
- Nhập danh sách công trình / giấy phép qua CSV/GeoJSON.
- Kiểm tra hợp lệ 100% dòng (tọa độ, số liệu không âm, định dạng ngày tháng), báo lỗi chi tiết từng dòng.
