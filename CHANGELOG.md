# Nhật ký thay đổi

## 2026-09-23 — Bản triển khai thử nghiệm

- Bật schema PostgreSQL/PostGIS với RLS, quyền service backend tối thiểu và kho ảnh riêng tư.
- Bổ sung scrypt salt ngẫu nhiên, kiểm soát RBAC, TOTP cho quản trị, khóa phiên bản, chống gửi lặp và thoát dữ liệu khi in/xuất.
- Tách fixture thử nghiệm khỏi dữ liệu thật; thêm kiểm thử dịch vụ, HTTP, trình duyệt, backup và restore.
- Thêm hướng dẫn triển khai, vận hành và phục hồi trên Supabase/Vercel.
