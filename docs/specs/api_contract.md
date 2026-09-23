# HỢP ĐỒNG GIAO DIỆN LẬP TRÌNH (API CONTRACT)
## Hệ thống QLTTXD Phường Thảo Nguyên

Hệ thống cung cấp chuẩn giao tiếp RESTful API JSON. Mọi phản hồi đều theo cấu trúc chuẩn:
- Thành công: `{ "success": true, "data": { ... }, "message": "..." }`
- Thất bại: `{ "success": false, "error": { "code": "ERROR_CODE", "message": "Thông báo tiếng Việt dễ hiểu" } }`

---

### 1. Public API (Người dân / Không cần đăng nhập)

#### `GET /api/public/permits`
- **Mục đích**: Lấy danh sách công trình hiển thị trên bản đồ công khai.
- **Dữ liệu trả về**: Mảng các công trình gồm `{ id, permit_number, site_address, construction_type, building_area, total_floor_area, floors_text, status, current_stage, longitude, latitude }`.
- **Bảo mật**: Không bao gồm `owner_name`, `owner_address`, `sender_phone`, etc.

#### `GET /api/public/permits/:id`
- **Mục đích**: Xem chi tiết thông tin công khai của một công trình.

#### `POST /api/public/complaints`
- **Mục đích**: Người dân gửi phản ánh hiện trường.
- **Headers**: `Idempotency-Key` (tùy chọn nhưng khuyến nghị để chống gửi trùng).
- **Body**:
  ```json
  {
    "title": "Phản ánh xây dựng sai phép",
    "content": "Công trình đang đổ mái lấn chiếm lối đi chung...",
    "location_text": "Tổ 3, phường Thảo Nguyên",
    "permit_id": "optional-permit-id",
    "longitude": 104.688,
    "latitude": 20.893,
    "is_anonymous": true,
    "sender_phone": "0987654321",
    "sender_email": "citizen@example.com"
  }
  ```
- **Dữ liệu trả về**: `{ id: "PA-2026-004", lookup_code: "TN-DEMO-7K4P", status: "Mới gửi" }`.

#### `GET /api/public/complaints/lookup?code=TN-DEMO-7K4P`
- **Mục đích**: Tra cứu tiến độ phản ánh của chính mình bằng mã bí mật.
- **Dữ liệu trả về**: Trạng thái, ngày gửi, vị trí, nội dung phản ánh, phản hồi chính thức từ phường (nếu có).

#### `GET /api/public/geojson/boundary`
- **Mục đích**: Lấy ranh giới địa giới hành chính 4 phường (Thảo Nguyên và vùng lân cận).

---

### 2. Internal API (Dành cho Cán bộ & Quản trị)

#### `POST /api/internal/auth/login`
- **Body**: `{ "username": "admin", "password": "...", "totp_token": "123456" }`
- **Phản hồi**: Thiết lập `Set-Cookie: session_id=...; HttpOnly; SameSite=Strict`.

#### `POST /api/internal/auth/logout`
- **Mục đích**: Hủy phiên làm việc.

#### `GET /api/internal/auth/me`
- **Mục đích**: Lấy thông tin cán bộ đang đăng nhập, vai trò và quyền hạn.

#### `GET /api/internal/permits`
- **Mục đích**: Lấy danh sách hồ sơ đầy đủ (bao gồm thông tin chủ hộ, tài liệu nội bộ).
- **Tham số**: `?query=...&status=...&page=1&limit=20`.

#### `POST /api/internal/permits`
- **Mục đích**: Nhập hồ sơ GPXD mới đã cấp phép.
- **Quyền**: `coordinator`, `admin`.

#### `POST /api/internal/inspections`
- **Mục đích**: Lập phiếu kiểm tra thực địa (mốc 1 - 4).
- **Quyền**: `inspector`, `coordinator`, `admin`.
- **Body**:
  ```json
  {
    "permit_id": "permit-01",
    "stage_index": 1,
    "inspect_date": "2026-09-15",
    "measured_area": 122.5,
    "measured_setback": 2.9,
    "measured_floors": 2,
    "notes": "Hiện trường thi công đúng tim mốc, khoảng lùi lệch 10cm cần theo dõi",
    "photos": ["base64-or-filename-array"]
  }
  ```

#### `POST /api/internal/inspections/:id/approve`
- **Mục đích**: Lãnh đạo / Người điều phối duyệt kết quả kiểm tra để cập nhật mốc hoàn thành.
- **Quyền**: `coordinator`, `admin`.

#### `GET /api/internal/inspections/:id/print`
- **Mục đích**: Xuất giao diện in phiếu kiểm tra HTML chuẩn.

#### `GET /api/internal/complaints`
- **Mục đích**: Xem toàn bộ danh sách phản ánh trên địa bàn.

#### `POST /api/internal/complaints/:id/step`
- **Mục đích**: Chuyển bước xử lý phản ánh (Tiếp nhận -> Phân công -> Báo cáo xác minh -> Duyệt phản hồi -> Mở lại).

#### `GET /api/internal/reports/summary`
- **Mục đích**: Lấy số liệu thống kê tổng hợp (tổng GPXD, số công trình cần kiểm tra, số mốc đã duyệt, phản ánh đang chờ).

#### `GET /api/internal/reports/export-csv`
- **Mục đích**: Xuất danh sách báo cáo định dạng CSV an toàn, chống Formula Injection.

#### `GET /api/internal/audit-logs`
- **Mục đích**: Xem lịch sử thao tác của các cán bộ trên hệ thống.
- **Quyền**: `admin`.
