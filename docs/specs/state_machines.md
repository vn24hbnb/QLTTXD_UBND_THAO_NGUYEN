# SƠ ĐỒ CHUYỂN TRẠNG THÁI NGHIỆP VỤ (STATE MACHINES)
## Hệ thống QLTTXD Phường Thảo Nguyên

### 1. Vòng đời Hồ sơ Công trình & Giấy phép (`Permit Lifecycle`)

```mermaid
stateDiagram-v2
    [*] --> NhapMoi: Cán bộ nhập hồ sơ từ GPXD
    NhapMoi --> ChoXacNhanViTri: Chưa gắn tọa độ bản đồ
    ChoXacNhanViTri --> CanKiemTra: Đã xác nhận vị trí & đến lịch mốc 1
    CanKiemTra --> DangThiCong: Mốc 1 được duyệt & đang thi công
    DangThiCong --> CanKiemTra: Đến hạn kiểm tra mốc 2/3/4
    DangThiCong --> TamDung: Phát hiện sai phạm / đình chỉ
    TamDung --> DangThiCong: Đã khắc phục sai phạm
    DangThiCong --> DaHoanThanh: Hoàn tất nghiệm thu đủ 4 mốc
    DaHoanThanh --> [*]
```

- **Quy tắc**:
  - Không thể tự động chuyển sang "Đã hoàn thành" khi chưa kiểm tra và duyệt đủ 4 mốc (hoặc có biên bản nghiệm thu hợp lệ).
  - Khi điều chỉnh GPXD: Giữ nguyên bản ghi cũ trong bảng lịch sử, tăng `version_id`, ghi nhận lý do và người cập nhật.

---

### 2. Quy trình Xử lý Phản ánh của Người dân (`Complaint Lifecycle`)

```mermaid
stateDiagram-v2
    [*] --> MoiGui: Người dân gửi (Ẩn danh / Có mã tra cứu)
    MoiGui --> DaTiepNhan: Cán bộ điều phối kiểm tra thông tin hợp lệ
    MoiGui --> TuChoi: Ngoài địa bàn / Thông tin không có cơ sở
    DaTiepNhan --> DaPhanCong: Giao cho cán bộ kiểm tra phụ trách tổ
    DaPhanCong --> DangKiemTra: Cán bộ tiếp nhận việc & đến hiện trường
    DangKiemTra --> ChoDuyet: Cán bộ nhập kết quả xác minh & đề xuất trả lời
    ChoDuyet --> DaPhanHoi: Lãnh đạo / Người điều phối duyệt phản hồi
    DaPhanHoi --> MoLai: Người dân kiến nghị bổ sung / Cần kiểm tra lại
    MoLai --> DangKiemTra: Tiếp tục xác minh thực tế
    DaPhanHoi --> DongHoSo: Kết thúc vụ việc
    DongHoSo --> [*]
```

- **Quy tắc**:
  - Tại bước "Chờ duyệt", người duyệt phải tích chọn xác nhận đã đọc nội dung trước khi bấm "Duyệt phản hồi".
  - Người dân tra cứu bằng mã bí mật chỉ đọc được trạng thái và kết quả sau khi đã được duyệt ("Đã phản hồi").

---

### 3. Quy trình Kiểm tra Hiện trường 4 Mốc (`Inspection Lifecycle`)

```mermaid
stateDiagram-v2
    [*] --> LenLich: Hệ thống / Cán bộ lập lịch theo tiến độ
    LenLich --> LuuNhap: Cán bộ ghi nhận số đo thực tế tại công trường
    LuuNhap --> GuiDuyet: Đính kèm ít nhất 1 ảnh hiện trường hợp lệ
    GuiDuyet --> DaDuyet: Lãnh đạo xác nhận kết quả đối chiếu GPXD
    GuiDuyet --> YeuCauDoLai: Số đo bất thường / ảnh không đạt
    YeuCauDoLai --> LuuNhap: Cán bộ kiểm tra lại hiện trường
    DaDuyet --> CapNhatTienDo: Đánh dấu mốc kiểm tra đạt ✓
    CapNhatTienDo --> [*]
```

- **Quy tắc**:
  - Nếu chỉ tiêu chưa đo: Lưu rõ "chưa đo / chưa xác định", tuyệt đối không mặc định là 0.
  - Ảnh tải lên phải được kiểm tra tính hợp lệ về định dạng và mã băm SHA-256.
