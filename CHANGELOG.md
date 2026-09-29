# Nhật ký thay đổi

## 2026-09-29 — Hiển thị kiến nghị mới gửi

- Cán bộ thấy ngay mọi phản ánh đang xử lý trên bản đồ (ghim theo tiến độ) và số đếm phản ánh được nạp khi vào trang, không cần mở mục Phản ánh trước.
- Người dân thấy ghim "Kiến nghị của bạn" ngay sau khi gửi (tra bằng mã bí mật đã lưu trên trình duyệt); tra cứu trả thêm tọa độ cho đúng người gửi. Ghim công khai của người khác vẫn chỉ hiện khi đã được cán bộ xác minh.

## 2026-09-29 — Bản đồ công khai hiển thị vị trí phản ánh

- Thêm `GET /api/public/complaints/map` và lớp ghim tím "Vị trí phản ánh nhân dân" trên bản đồ (bật/tắt được), chỉ gồm phản ánh đã được cán bộ xác minh; che số điện thoại/email trong địa chỉ; không lộ mã tra cứu hay nội dung.
- Khóa bằng kiểm thử danh sách trường công khai của giấy phép (chỉ giới xây dựng, đường đỏ, số tầng, diện tích, chiều cao).

## 2026-09-29 — Tăng cường bảo mật và vận hành (1.1.0)

- Token phiên chỉ lưu dạng băm SHA-256; khóa TOTP mã hóa AES-256-GCM (`TOTP_ENCRYPTION_KEY`); khóa tài khoản 15 phút sau 5 lần sai; bắt buộc TOTP cho quản trị và điều phối khi tạo tài khoản.
- Thêm vai trò `receptionist` (cán bộ tiếp nhận) với quyền tối thiểu; chặn sửa/xóa `audit_logs` bằng trigger ở SQLite và PostgreSQL.
- Migration: `src/db/migrations/002_auth_hardening.json` (SQLite) và `supabase/migrations/20260929000000_auth_hardening.sql` (PostgreSQL). Cả hai thu hồi phiên đăng nhập hiện có.
- Đóng gói Leaflet trong `public/vendor/leaflet`, bỏ `unpkg.com` khỏi CSP và service worker.
- Tách `server.js` thành `src/http/` và `src/routes/`; phiên bản health đọc từ `package.json`.
- Sửa Dockerfile/compose (không seed dữ liệu mẫu ở production, cài đủ dependency); CI kiểm tra cú pháp và áp dụng migration lên PostGIS thật.
- Thêm `verify:backup-freshness` và hướng dẫn lập lịch sao lưu.

## 2026-09-28 — Thông tin người dân và theo dõi kiến nghị

- Rút gọn thông tin giấy phép công khai, chỉ hiện các chỉ tiêu có dữ liệu như chiều cao, số tầng, diện tích và chỉ giới.
- Thêm mục “Kiến nghị của tôi” trong tài khoản và menu; tự lưu mã tra cứu trên trình duyệt sau khi gửi, cho phép thêm mã cũ và xem tiến độ/phản hồi đã duyệt.
- Chỉ tra cứu bằng các mã bí mật đã lưu hoặc do người dân nhập; không bổ sung API danh sách phản ánh công khai.

## 2026-09-28 — Kiểm tra và hoàn thiện nhập giấy phép

- Bổ sung các chỉ tiêu giấy phép trên biểu mẫu nhập thủ công và mẫu CSV UTF-8.
- Nhận diện đầy đủ tên cột tiếng Việt/Anh, CSV dấu chấm phẩy/tab và số thập phân dùng dấu phẩy; báo lỗi cột lạ thay vì bỏ qua dữ liệu.
- Chống gửi lặp khi lưu giấy phép; loại bỏ kết quả xem trước của tệp cũ và giữ nguyên lô nhập khi thử lại sau mất mạng.
- Tài khoản seed cục bộ không yêu cầu TOTP; tài khoản đã bật TOTP chỉ hiện ô mã sau khi máy chủ yêu cầu.

## 2026-09-23 — Bản triển khai thử nghiệm

- Bật schema PostgreSQL/PostGIS với RLS, quyền service backend tối thiểu và kho ảnh riêng tư.
- Bổ sung scrypt salt ngẫu nhiên, kiểm soát RBAC, TOTP cho quản trị, khóa phiên bản, chống gửi lặp và thoát dữ liệu khi in/xuất.
- Tách fixture thử nghiệm khỏi dữ liệu thật; thêm kiểm thử dịch vụ, HTTP, trình duyệt, backup và restore.
- Thêm hướng dẫn triển khai, vận hành và phục hồi trên Supabase/Vercel.
