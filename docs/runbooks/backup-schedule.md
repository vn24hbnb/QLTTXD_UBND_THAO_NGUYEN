# Lịch sao lưu và cảnh báo RPO

Mục tiêu nghiệm thu: RPO ≤ 24 giờ, RTO ≤ 1 ngày làm việc. Sao lưu **không tự chạy**; cần một máy vận hành có quyền tới Supabase, `pg_dump` 17/18 (`PG_DUMP`) và tệp `.env` bỏ qua Git.

## Lập lịch (Linux, cron) — chạy 02:15 hằng ngày, kiểm tra độ mới lúc 07:30

```cron
15 2 * * *  cd /srv/qlttxd && /usr/bin/npm run backup:cloud >> /var/log/qlttxd-backup.log 2>&1
30 7 * * *  cd /srv/qlttxd && /usr/bin/npm run verify:backup-freshness -- backups 24 || /usr/local/bin/gui-canh-bao.sh "Sao lưu QLTTXD quá hạn RPO"
```

`verify:backup-freshness` thoát mã 1 khi không có bản sao lưu hợp lệ hoặc bản mới nhất quá 24 giờ; nối mã thoát này vào kênh cảnh báo của đơn vị (thư điện tử, Zalo/Telegram bot, hệ thống giám sát).

## Yêu cầu vận hành

- Bản sao lưu chứa PII và ảnh hiện trường: đặt thư mục `backups/` trên ổ mã hóa, quyền 0700, và sao chép định kỳ sang nơi lưu trữ thứ hai do đơn vị kiểm soát. Không tải bản sao lưu lên CI hoặc kho mã.
- Giữ tối thiểu 7 bản hằng ngày và 4 bản hằng tuần; xóa bản cũ hơn bằng chính sách của đơn vị.
- Mỗi quý chạy `npm run verify:postgres-restore -- backups/cloud_<id>` (hoặc `restore:cloud` trên cơ sở dữ liệu sạch) và ghi kết quả vào `docs/reviews/`.
- Ghi nhận `TOTP_ENCRYPTION_KEY` ở kho bí mật riêng: mất khóa này thì khóa TOTP đã mã hóa trong bản sao lưu không giải mã được, và cán bộ có TOTP phải được cấp lại.
