# Nhật ký thay đổi

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
