# MA TRẬN PHÂN QUYỀN TRUY CẬP (RBAC MATRIX)
## Hệ thống QLTTXD Phường Thảo Nguyên

### 1. Phân định Vai trò (Roles)
- **Public / Khách (Citizen)**: Người dân truy cập tự do không cần đăng nhập hoặc có tài khoản tra cứu phản ánh.
- **Receptionist (Cán bộ tiếp nhận)**: Chỉ xem hồ sơ/phản ánh, thực hiện bước 1 (tiếp nhận) và 2 (phân công) của phản ánh. Không xem kiểm tra, biên bản, báo cáo, nhật ký; không tải tệp.
- **Inspector (Cán bộ kiểm tra)**: Cán bộ địa chính - xây dựng trực tiếp đi thực địa.
- **Coordinator (Người điều phối)**: Cán bộ phụ trách tiếp nhận phản ánh, phân công và kiểm tra hồ sơ.
- **Admin (Lãnh đạo / Quản trị)**: Lãnh đạo UBND phường hoặc quản trị viên hệ thống có quyền phê duyệt cao nhất.

---

### 2. Ma trận Quyền trên Chức năng & Dữ liệu

| Nghiệp vụ / Dữ liệu | Khách / Người dân | Cán bộ kiểm tra | Người điều phối | Lãnh đạo / Admin |
|---|:---:|:---:|:---:|:---:|
| **Xem bản đồ công khai (vị trí, trạng thái, số tầng, DT)** | Cho phép | Cho phép | Cho phép | Cho phép |
| **Xem thông tin PII chủ nhà (Họ tên, SĐT, nơi ở)** | **Chặn** | Cho phép | Cho phép | Cho phép |
| **Nhập hồ sơ GPXD mới** | **Chặn** | **Chặn** | Cho phép | Cho phép |
| **Lập dự thảo phiếu kiểm tra mốc 1-4 & tải ảnh** | **Chặn** | Cho phép | Cho phép | Cho phép |
| **Phê duyệt kết quả kiểm tra công trình** | **Chặn** | **Chặn** | Cho phép | Cho phép |
| **Gửi phản ánh mới** | Cho phép | Cho phép | Cho phép | Cho phép |
| **Xem danh sách tất cả phản ánh của phường** | **Chặn** | Cho phép | Cho phép | Cho phép |
| **Xem phản ánh của chính mình qua mã bí mật** | Cho phép | Cho phép | Cho phép | Cho phép |
| **Tiếp nhận & Phân công phản ánh** | **Chặn** | **Chặn** | Cho phép | Cho phép |
| **Nhập kết quả xác minh phản ánh** | **Chặn** | Cho phép | Cho phép | Cho phép |
| **Phê duyệt phản hồi người dân & Đóng/Mở lại** | **Chặn** | **Chặn** | Cho phép | Cho phép |
| **Xem thống kê báo cáo & Xuất CSV** | **Chặn** | Cho phép | Cho phép | Cho phép |
| **Xem nhật ký kiểm toán (Audit Logs)** | **Chặn** | **Chặn** | **Chặn** | Cho phép |
| **Thực hiện sao lưu & Phục hồi hệ thống** | **Chặn** | **Chặn** | **Chặn** | Cho phép |

---

### 3. Chính sách Kiểm soát Truy cập tại Tầng API
- **Public API (`/api/public/*`)**: Không yêu cầu xác thực phiên. Mọi câu lệnh SQL truy vấn đều giới hạn tường minh (SELECT white-listed fields only). Tuyệt đối không dùng `SELECT *`.
- **Internal API (`/api/internal/*`)**: Yêu cầu xác thực qua Session Cookie (hoặc Bearer Token có hiệu lực). Middleware kiểm tra quyền (Role Guard) chặn mọi request không đúng thẩm quyền với mã lỗi `401 Unauthorized` hoặc `403 Forbidden`.
- **Private Files (`/api/files/*`)**: Tệp tin ảnh và tài liệu lưu ở thư mục riêng tư, chỉ tải qua API có kiểm tra quyền đăng nhập của cán bộ. Khách chỉ được xem ảnh phản ánh đã được phê duyệt công khai.

### 4. Xác thực và phiên (cập nhật 29/09/2026)
- Token phiên chỉ lưu dạng SHA-256 trong CSDL; cookie giữ token gốc, hạn 24 giờ.
- Khóa TOTP mã hóa AES-256-GCM bằng `TOTP_ENCRYPTION_KEY` (≥ 32 ký tự; bắt buộc ở production). Quản trị và điều phối bắt buộc có TOTP khi tạo bằng `create-staff.js`.
- Nhập sai mật khẩu hoặc TOTP 5 lần liên tiếp khóa tài khoản 15 phút và ghi `ACCOUNT_LOCKED` vào nhật ký. Phản hồi khi bị khóa giống hệt sai mật khẩu.
- Nhật ký kiểm toán chỉ ghi thêm: trigger CSDL chặn UPDATE/DELETE (SQLite và PostgreSQL).
- Quyền của từng endpoint nằm trong `src/routes/internal.js`; quyền theo vai trò cho cán bộ tiếp nhận được chặn tập trung ở đầu nhóm route nội bộ.
- **Chưa thực hiện:** giới hạn cán bộ kiểm tra chỉ xem hồ sơ/biên bản được phân công. Hệ thống chưa có mô hình phân công hồ sơ (chỉ phản ánh có `assigned_to`), cần chốt quy trình nghiệp vụ trước khi thêm.
