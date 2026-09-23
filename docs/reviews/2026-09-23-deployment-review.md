# Rà soát triển khai — 23/09/2026

## Kết quả

Bản thử nghiệm triển khai trên Vercel; PostgreSQL 17.6/PostGIS trên Supabase Singapore; kho ảnh `qlttxd-private` private. Cơ sở dữ liệu vừa tạo chỉ có tài khoản quản trị do tác vụ triển khai khởi tạo, chưa có hồ sơ GPXD hay phản ánh nghiệp vụ. Dữ liệu mẫu chỉ nạp cục bộ khi yêu cầu.

## Đã sửa

- API nội bộ yêu cầu cookie phiên HTTP-only, vai trò lấy từ tài khoản đã xác thực; public permit chỉ trả trường cho phép và mặc định không công bố.
- PII phản ánh/hồ sơ không xuất hiện qua public API; ảnh hiện trường kiểm tra lại JPEG/PNG, kích thước, người tải và SHA-256, không mở kho public.
- Cập nhật và duyệt dùng `version_id`; phải duyệt các mốc kiểm tra theo trình tự; ảnh hiện trường cần tệp thật; tạm dừng không bị tự bỏ qua.
- Xác nhận phản hồi trước công bố; khóa tra cứu không chia sẻ mã hồ sơ gộp; import CSV kiểm tra cùng nghiệp vụ và giao dịch rollback.
- Mật khẩu scrypt salt riêng; vá cookie lỗi, JSON lỗi, CSRF, no-store, lỗi SQL công khai, CSV formula, HTML print và benchmark giả.
- Sao lưu SQLite snapshot WAL nhất quán, xác minh hash, integrity và foreign key; bổ sung PostgreSQL dump cùng ảnh private.

## Kiểm chứng

- `npm test`: 73/73 đạt.
- `npm audit --omit=dev`: không phát hiện lỗ hổng trong các dependency runtime.
- HTTP tải cục bộ: 100/100 request, P95 75 ms (dữ liệu giả lập; không phải kiểm định tải production).
- PostgreSQL thật: kiểm tra kết nối TLS có CA, role ứng dụng và PostGIS; transaction kiểm tra rollback, hồ sơ riêng tư/công bố, ảnh private, retry idempotency, duyệt kiểm tra và tra cứu phản ánh.
- Backup PostgreSQL tạo thành công và phục hồi thử lên CSDL PostgreSQL mới (PostgreSQL 18): 13 bảng, 1 tài khoản, PostGIS SRID 4326.
- Vercel health endpoint và trình duyệt trả HTTP 200; không có lỗi console.

## Việc cần hoàn tất trước nghiệm thu production

- Cài lịch `backup:cloud` ít nhất hằng ngày và thử phục hồi qua cơ sở dữ liệu Supabase sạch để chứng minh RPO/RTO.
- Tải mã lên kho GitHub sau khi chủ tài khoản hoàn tất xác minh đăng nhập mà GitHub yêu cầu qua email.
- Đối soát dữ liệu thực, hồ sơ pháp lý và nguồn ranh giới GIS chính thức trước khi công bố rộng rãi.
