# TỪ ĐIỂN DỮ LIỆU CHUẨN (DATA DICTIONARY)
## Hệ thống QLTTXD Phường Thảo Nguyên

### 1. Bảng `users` (Tài khoản người dùng)
| Tên cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | Khóa chính (UUID / chuỗi định danh) |
| `username` | TEXT | UNIQUE, NOT NULL | Tên đăng nhập cán bộ |
| `password_hash` | TEXT | NOT NULL | Mật khẩu băm (Argon2 / PBKDF2 / SHA-256 có salt) |
| `full_name` | TEXT | NOT NULL | Họ và tên cán bộ |
| `role` | TEXT | NOT NULL | Vai trò: `admin`, `coordinator`, `inspector`, `citizen` |
| `totp_secret` | TEXT | NULL | Khóa bí mật TOTP (Base32) |
| `is_active` | INTEGER | DEFAULT 1 | Trạng thái hoạt động (1: Hoạt động, 0: Khóa) |
| `created_at` | TEXT | NOT NULL | Thời điểm tạo (ISO UTC) |

### 2. Bảng `permits` (Hồ sơ Giấy phép xây dựng)
| Tên cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | Khóa định danh hồ sơ |
| `permit_number` | TEXT | UNIQUE, NOT NULL | Số GPXD (VD: 018/2026/GPXD) |
| `issue_date` | TEXT | NOT NULL | Ngày cấp phép |
| `issuing_authority`| TEXT | NOT NULL | Cơ quan cấp phép |
| `owner_name` | TEXT | NOT NULL (Hạn chế) | Người/tổ chức được cấp GPXD (Bảo mật) |
| `owner_address` | TEXT | (Hạn chế) | Địa chỉ nơi cư trú của chủ hộ (Bảo mật) |
| `construction_type`| TEXT | NOT NULL | Loại công trình (VD: Nhà ở riêng lẻ) |
| `site_address` | TEXT | NOT NULL | Địa điểm xây dựng (Số nhà, đường, tổ dân phố) |
| `land_area` | REAL | | Diện tích lô đất (m²) |
| `building_area` | REAL | | Diện tích xây dựng (m²) |
| `total_floor_area`| REAL | | Tổng diện tích sàn (m²) |
| `land_use_ratio` | REAL | | Hệ số sử dụng đất |
| `floors_text` | TEXT | | Số tầng ghi nguyên văn theo giấy phép |
| `confirmed_floors`| INTEGER | | Số tầng cao đã xác nhận thực tế |
| `setback_text` | TEXT | | Chỉ giới và khoảng lùi theo hồ sơ duyệt |
| `status` | TEXT | NOT NULL | Trạng thái: `Cần kiểm tra`, `Đang thi công`, `Đã hoàn thành`, `Chờ xác nhận vị trí` |
| `current_stage` | INTEGER | DEFAULT 0 | Mốc hiện tại (0: Chưa mốc nào, 1..4: Mốc 1-4) |
| `longitude` | REAL | | Kinh độ WGS84 |
| `latitude` | REAL | | Vĩ độ WGS84 |
| `commune_code` | TEXT | DEFAULT '03982' | Mã phường (03982: Thảo Nguyên) |
| `version_id` | INTEGER | DEFAULT 1 | Phiên bản hồ sơ |
| `is_public` | INTEGER | DEFAULT 1 | Đã duyệt công khai (1: Có, 0: Nội bộ) |
| `created_at` | TEXT | NOT NULL | Thời điểm tạo |
| `updated_at` | TEXT | NOT NULL | Thời điểm cập nhật cuối |

### 3. Bảng `inspections` (Biên bản / Lần kiểm tra hiện trường)
| Tên cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | Khóa định danh lần kiểm tra |
| `permit_id` | TEXT | FOREIGN KEY | Liên kết bảng `permits` |
| `stage_index` | INTEGER | NOT NULL | Mốc kiểm tra (0..3 tương ứng mốc 1..4) |
| `inspector_id` | TEXT | FOREIGN KEY | Cán bộ kiểm tra |
| `inspect_date` | TEXT | NOT NULL | Ngày kiểm tra thực địa |
| `measured_area` | REAL | | Diện tích đo thực tế (m²) |
| `measured_setback`| REAL | | Khoảng lùi đo thực tế (m) |
| `measured_floors` | INTEGER | | Số tầng ghi nhận thực tế |
| `notes` | TEXT | | Ghi chép / hiện trạng hiện trường |
| `status` | TEXT | NOT NULL | Trạng thái: `draft`, `pending_approval`, `approved`, `rejected` |
| `approved_by` | TEXT | | Người duyệt kết quả |
| `approved_at` | TEXT | | Thời điểm duyệt |
| `created_at` | TEXT | NOT NULL | Thời điểm tạo |

### 4. Bảng `inspection_photos` (Ảnh hiện trường)
| Tên cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | Khóa định danh ảnh |
| `inspection_id`| TEXT | FOREIGN KEY | Liên kết bảng `inspections` |
| `file_name` | TEXT | NOT NULL | Tên tệp lưu trữ |
| `file_size` | INTEGER | NOT NULL | Dung lượng tệp (bytes) |
| `mime_type` | TEXT | NOT NULL | Định dạng MIME (`image/jpeg`, `image/png`) |
| `sha256_hash` | TEXT | NOT NULL | Mã băm toàn vẹn SHA-256 |
| `caption` | TEXT | | Chú thích ảnh hiện trường |
| `created_at` | TEXT | NOT NULL | Thời điểm tải lên |

### 5. Bảng `complaints` (Phản ánh của người dân)
| Tên cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| `id` | TEXT | PRIMARY KEY | Mã hiển thị (VD: PA-2026-001) |
| `lookup_code` | TEXT | UNIQUE | Mã tra cứu bí mật cho người dân (VD: TN-DEMO-7K4P) |
| `title` | TEXT | NOT NULL | Tiêu đề phản ánh |
| `content` | TEXT | NOT NULL | Nội dung chi tiết |
| `location_text`| TEXT | NOT NULL | Địa chỉ hoặc mô tả vị trí |
| `permit_id` | TEXT | NULL, FOREIGN KEY | Gắn với công trình cụ thể (nếu có) |
| `longitude` | REAL | | Kinh độ phản ánh |
| `latitude` | REAL | | Vĩ độ phản ánh |
| `is_anonymous` | INTEGER | DEFAULT 1 | 1: Ẩn danh, 0: Có tài khoản/SĐT |
| `sender_phone` | TEXT | (Hạn chế) | Số điện thoại người gửi (Bảo mật) |
| `sender_email` | TEXT | (Hạn chế) | Email người gửi (Bảo mật) |
| `status_step` | INTEGER | DEFAULT 0 | Bước xử lý (0: Mới gửi, 1: Đã tiếp nhận, 2: Đã phân công, 3: Đang kiểm tra, 4: Chờ duyệt, 5: Đã phản hồi) |
| `assigned_to` | TEXT | | Cán bộ được phân công |
| `investigation_notes` | TEXT | | Kết quả xác minh của cán bộ |
| `official_reply`| TEXT | | Nội dung phản hồi chính thức tới người dân |
| `idempotency_key` | TEXT | UNIQUE | Khóa chống trùng khi gửi lặp |
| `created_at` | TEXT | NOT NULL | Thời điểm gửi |
| `updated_at` | TEXT | NOT NULL | Thời điểm cập nhật cuối |

### 6. Bảng `audit_logs` (Nhật ký kiểm toán hệ thống)
| Tên cột | Kiểu dữ liệu | Ràng buộc | Mô tả |
|---|---|---|---|
| `id` | INTEGER | PRIMARY KEY AUTOINCREMENT | Khóa tăng dần |
| `user_id` | TEXT | | Người thực hiện (hoặc 'anonymous') |
| `action` | TEXT | NOT NULL | Hành động: `CREATE_PERMIT`, `INSPECT_SUBMIT`, `APPROVE_CHECK`, `SUBMIT_COMPLAINT`, etc. |
| `entity_type` | TEXT | NOT NULL | Thực thể: `permits`, `inspections`, `complaints` |
| `entity_id` | TEXT | NOT NULL | ID thực thể |
| `details` | TEXT | | Chi tiết JSON (giá trị thay đổi) |
| `ip_address` | TEXT | | Địa chỉ IP gửi yêu cầu |
| `created_at` | TEXT | NOT NULL | Thời điểm ghi nhận (UTC) |
