# Kiểm tra nhập giấy phép — 28/09/2026

## Phạm vi và sửa lỗi

- Biểu mẫu thủ công: bổ sung các chỉ tiêu đã được API hỗ trợ, bao gồm địa chỉ chủ đầu tư, đất, tổng diện tích sàn, tầng hầm/lửng, chiều cao, mật độ, chỉ giới, thiết kế và thời hạn giấy phép.
- CSV: ánh xạ chính xác các cột, tránh ghi số tầng hầm/lửng vào quy mô tầng; báo cột lạ để tránh mất dữ liệu âm thầm. Bổ sung mẫu UTF-8, chấm phẩy/tab, ngày hết hạn và dấu phẩy thập phân.
- Nhập thủ công: truyền và xử lý Idempotency-Key, trả xung đột cho số giấy phép đã tồn tại.
- Giao diện nhập CSV: bỏ kết quả xem trước của tệp cũ, chặn gửi đồng thời, giữ nguyên dữ liệu và khóa khi thử lại sau lỗi mạng.

## Kiểm chứng

- 81 kiểm thử trên cơ sở dữ liệu tạm riêng: API, phân quyền, riêng tư, nhập CSV, khóa chống gửi lặp và các luồng nghiệp vụ hiện có đều đạt.
- npm audit --omit=dev: không phát hiện lỗ hổng từ nguồn cảnh báo của npm tại thời điểm chạy.
- Trình duyệt cục bộ: đăng nhập admin thử nghiệm; nhập thủ công mở được chi tiết hồ sơ; CSV chấm phẩy có số thập phân dùng dấu phẩy xem trước 1 dòng hợp lệ, ghi thành công và tìm thấy hồ sơ với diện tích 100.5 m². Không có lỗi JavaScript ghi nhận trong lượt kiểm tra trình duyệt.
- Kiểm thử ghi dữ liệu chỉ thực hiện trên SQLite tạm. Chưa thực hiện nhập hồ sơ giả vào PostgreSQL production; kiểm tra deployment production dùng các yêu cầu chỉ đọc.
- Đợt này không thay đổi schema hay chuyển đổi hồ sơ hiện có. Không chạy seed hoặc test trong workspace chính có dữ liệu đang làm việc.
