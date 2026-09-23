# Quản lý trật tự xây dựng phường Thảo Nguyên

Website thử nghiệm quản lý hồ sơ giấy phép, bản đồ công trình đã công bố, phản ánh người dân, kiểm tra hiện trường theo bốn mốc và báo cáo. Ứng dụng không kèm hồ sơ thật hoặc tài khoản mặc định.

## Môi trường

- Node.js 24 LTS, ESM
- PostgreSQL 17 + PostGIS trên máy chủ Supabase
- SQLite `node:sqlite` cho phát triển và kiểm thử cục bộ
- Lưu ảnh JPEG/PNG riêng tư trên Supabase Storage

## Cục bộ

```sh
npm ci
npm test
npm start
```

Ứng dụng cục bộ tạo `data/qlttxd.db` khi chạy. Tạo fixture giả lập riêng bằng `npm run seed`. Lệnh seed từ chối PostgreSQL và production. Không chép dữ liệu production vào kiểm thử.

## Cấu hình production

Tạo dự án PostgreSQL Supabase trống và áp dụng tệp trong `supabase/migrations/`. Migration bật PostGIS, Row Level Security cho mọi bảng nghiệp vụ, hạn chế dữ liệu API công khai, và tạo kho ảnh `qlttxd-private` ở chế độ private.

Thiết lập trên máy chủ:

```text
NODE_ENV=production
DATABASE_URL=postgresql://qlttxd_app.<project-ref>:<password>@<transaction-pooler-host>:6543/postgres
DATABASE_CA_CERT=<CA certificate từ Database Settings>
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<khóa server secret; không dùng publishable key>
SUPABASE_STORAGE_BUCKET=qlttxd-private
```

Dùng Transaction Pooler cho Vercel. Bật xác thực SSL bằng CA Supabase; không đặt `rejectUnauthorized=false`. Không thêm `.env`, khóa API, dữ liệu CSDL, bản backup hay thông tin đăng nhập lên Git. Có thể thêm tên miền đã xác minh qua `APP_ORIGIN`.

## Tài khoản cán bộ

Sau khi migration và biến môi trường có hiệu lực, tạo tài khoản ban đầu bằng CLI tương tác quản trị:

```sh
node --env-file=.env.production scripts/create-staff.js <username> admin <password-file> <totp-file>
```

Mật khẩu phải dài ít nhất 16 ký tự; quản trị viên cần khóa TOTP riêng có 32 ký tự Base32. Tạo coordinator hoặc inspector tương tự, bỏ đường dẫn TOTP. Không chia sẻ tệp mật khẩu.

## Sao lưu / phục hồi

- `npm run backup` tạo snapshot SQLite nhất quán, kiểm tra checksum, integrity và khóa ngoại.
- `npm run backup:cloud` dùng `pg_dump` tương thích PostgreSQL, TLS đã xác thực, đồng thời sao lưu ảnh private và SHA-256. Cấu hình kết nối bằng biến môi trường hoặc tệp `.env` bỏ qua Git; cần `PG_DUMP` trỏ đến `pg_dump` cài từ PostgreSQL 17/18 client.
- `npm run restore` yêu cầu thư mục backup và thư mục đích mới: `npm run restore -- backups/backup_<id> /srv/qlttxd-recovery`. Lệnh không ghi đè thư mục đang dùng.
- Phục hồi PostgreSQL dùng `node --env-file=.env.recovery scripts/restore-cloud.js backups/cloud_<id>`. CSDL đích phải mới, có PostGIS trong schema `extensions` và kho ảnh private trống. Đã diễn tập phục hồi bản Supabase hiện tại lên PostgreSQL sạch; lệnh phục hồi thực tế chỉ chạy trên môi trường recovery riêng.

Mỗi bản sao ghi lại thời điểm, số lượng hàng và mã SHA-256. Bản sao Supabase tạo ngày 23/09/2026 đã phục hồi thành công lên cụm PostgreSQL 18 sạch: đủ 13 bảng, 1 tài khoản quản trị, PostGIS SRID 4326. Cần chạy `backup:cloud` bằng lịch vận hành để duy trì RPO 24 giờ; một lần sao lưu thành công không tự tạo lịch định kỳ. Hãy kiểm tra phục hồi trên môi trường sạch trước khi nghiệm thu production.

## API và dữ liệu

API trả JSON tiếng Việt. Người dân chỉ xem dữ liệu giấy phép đã công bố; danh tính chủ hộ, thông tin liên hệ, bản nháp phản ánh và ảnh hiện trường ở vùng nội bộ. Ghi nhận kiểm tra, phản ánh và nhập CSV dùng xác thực phía máy chủ, khóa phiên bản và `Idempotency-Key` ở luồng phù hợp.

Ranh giới bản đồ nằm ở `data/thao_nguyen_geo.json`, GeoJSON WGS-84 `[kinh độ, vĩ độ]`. Đối soát nguồn dữ liệu GIS trước khi dùng làm ranh giới nghiệp vụ chính thức.

## Triển khai

Dự án liên kết với Vercel, chạy một hàm Node.js tại Singapore và phục vụ tài nguyên từ `public/`. Biến nhạy cảm chỉ đặt ở Production Environment. Kiểm tra bản preview trước khi chuyển production:

```sh
vercel link
vercel env add DATABASE_URL production --sensitive
vercel deploy
vercel deploy --prod
```

CI kiểm thử Node 24 trên GitHub Actions. Tài khoản Vercel Hobby có thể giới hạn lịch Cron; backup định kỳ hiện được vận hành từ máy có quyền tới Supabase.
