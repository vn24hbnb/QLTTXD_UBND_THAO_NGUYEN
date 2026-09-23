# Báo cáo giám sát mã nguồn và đối chiếu tiến độ QLTTXD

Ngày: 15/09/2026. Mã nguồn nền: `236c2b2`.

## 1. Kết luận

**Chưa đủ điều kiện nghiệm thu mốc A hoặc đưa dữ liệu thật vào sử dụng.** Đã có nhiều thành phần chức năng và bộ kiểm thử, nhưng còn lỗi rò rỉ dữ liệu, sai quyền, mất dữ liệu khi khôi phục/đồng bộ và sai trạng thái nghiệp vụ. Tên các commit “hoàn thành mốc A/B/C” không tương đương bằng chứng nghiệm thu.

Theo kế hoạch, ngày 15/09 vẫn thuộc giai đoạn chốt phạm vi 14–16/09; thử mốc A dự kiến 1–7/10. Vì vậy **chưa thể kết luận dự án trễ hạn**, nhưng chất lượng và thứ tự ưu tiên hiện chưa bám các điều kiện qua mốc. Không quy đổi số tệp hoặc số test thành phần trăm hoàn thành dự án.

## 2. Phạm vi và cách kiểm tra

- Đối chiếu `AGENTS.md`, `Ke hoach Du an QLXD.md`, năm tài liệu đặc tả, mã máy chủ, giao diện, dữ liệu khởi tạo, triển khai và kiểm thử.
- Rà soát độc lập các nhóm bảo mật, toàn vẹn dữ liệu và giao diện; xác minh các lỗi trọng yếu bằng HTTP cục bộ, CSDL và môi trường phục hồi biệt lập.
- Bộ kiểm thử chạy bằng Node.js v24.18.0 trên bản sao mã và dữ liệu mẫu được tạo mới; không chạy phép thử ghi trên CSDL làm việc của người dùng.
- Có cập nhật giao diện bên ngoài đợt giám sát trong lúc kiểm tra. Đã đọc lại thay đổi hiện có: lỗi truyền sai lớp bọc GeoJSON đã được chỉnh trong `public/app.js`, nên không đưa lỗi đó vào danh sách còn mở. Các vị trí giao diện dưới đây tham chiếu bản làm việc sau cập nhật này.
- Chỉ bổ sung báo cáo và bằng chứng. Không sửa mã ứng dụng, không phục hồi hay thay thế CSDL hiện hữu.
- Chưa có kiểm chứng trên VPS, thiết bị người dùng thật, dữ liệu địa chính được đơn vị xác nhận hoặc hồ sơ nghiệm thu nghiệp vụ. Những phần đó được ghi là chưa có bằng chứng, không coi là đã kiểm thử đạt.

## 3. Kết quả thực nghiệm

| Phép kiểm tra | Kết quả quan sát |
|---|---|
| Bộ test sau khi tạo dữ liệu mẫu | 38/38 đạt, không bỏ qua test |
| Bộ test với CSDL sạch chưa nạp mẫu | Lượt chạy này 30 đạt, 8 lỗi; bộ test phụ thuộc dữ liệu có sẵn |
| Tài khoản vai trò citizen đọc API hồ sơ nội bộ | HTTP 200, có trường tên và địa chỉ cư trú chủ hộ |
| Tệp tải lên khai báo PDF, tên `.html` | Được chấp nhận; khách không đăng nhập tải được với `text/html`, thẻ script còn nguyên |
| Chỉ lập và duyệt mốc 4, không có ảnh | Công trình thành “Đã hoàn thành”, trong CSDL chỉ có một mốc được duyệt |
| Cùng nội dung và Idempotency-Key gửi phiếu hai lần | Hai HTTP 201, hai ID và hai bản ghi khác nhau |
| Gửi phiếu qua URL mà giao diện đang dùng, với phiên hợp lệ | HTTP 200 dạng HTML; số phiếu tăng 0 |
| Cookie sai định dạng | Một request làm tiến trình máy chủ thử nghiệm thoát mã 1 với URIError |
| Sao lưu khi giao dịch đã ghi vào WAL, rồi khôi phục sạch | Bản gốc 1 bản ghi, phục hồi 0; cả hai script vẫn báo thành công |
| Đo tải gốc | 300 yêu cầu thành công trên trình xử lý giả lập trong cùng tiến trình |
| Đo tải khi cố ý làm mã tra cứu không tồn tại | 50 yêu cầu tra cứu thất bại nhưng vẫn in “100%”, 250/250 và thoát mã 0 |

Bằng chứng lưu tại `docs/reviews/evidence/2026-09-15/`. Phép đo tải không đi qua kết nối HTTP thực, TLS, mạng hay trình duyệt; không dùng kết quả này để kết luận đáp ứng tải thí điểm.

## 4. Những lỗi cần xử lý trước nghiệm thu

Mức độ theo quy tắc dự án: P0 liên quan mất/rò rỉ dữ liệu hoặc sai quyền nghiêm trọng; P1 làm sai hồ sơ hoặc chặn tác vụ cốt lõi; P2 có đường xử lý thay thế. Các lỗi dưới đây đều có căn cứ mã nguồn; kết quả chạy được nêu riêng để phân biệt với rà soát tĩnh.

### R01 — P0: Người dân truy cập và thao tác được trong API nội bộ

Vị trí: `src/server.js:274`, `:281`, `:308`, `:340`, `:411`; `src/services/complaints.js:147`.

Middleware chỉ kiểm tra có phiên, không giới hạn vai trò cán bộ. Tài khoản citizen có trong seed đăng nhập được rồi đọc hồ sơ có PII và toàn bộ phản ánh, gồm mã tra cứu bí mật. Một số route tạo phiếu, cập nhật phản ánh và vi phạm cũng thiếu kiểm tra vai trò. Đã xác minh citizen đọc hồ sơ HTTP 200; rà soát độc lập cũng xác minh inspector tự đưa phản ánh sang bước 5 và công bố câu trả lời.

Khắc phục: chặn mặc định các vai trò không được phép; áp ma trận quyền cho từng thao tác, trạng thái và phạm vi hồ sơ; bổ sung test HTTP trái quyền cho tất cả vai trò. Việc đổi chữ vai trò trên giao diện không thay thế kiểm tra này.

### R02 — P0: Tệp nội bộ tải được không cần đăng nhập

Vị trí: `src/server.js:517`.

Route `/api/files/:fileName` trả tệp trực tiếp, không xác thực hay kiểm tra quyền hồ sơ. Đã tải tệp thử nghiệm bằng khách không cookie và nhận HTTP 200. Tên tệp khó đoán không phải quyền truy cập; liên kết cũ vẫn dùng được sau đăng xuất.

Khắc phục: quản lý tệp gắn với hồ sơ và quyền công khai, kiểm tra mỗi lần tải, kiểm tra thu hồi quyền và ngăn cache tệp hạn chế.

### R03 — P0: Nội dung người dùng có thể trở thành mã chạy trong trang

Vị trí: `src/services/storage.js:66`, `:71`; `src/server.js:102`; `src/services/inspections.js:217`, `:256`.

Upload chỉ nhận diện vài byte đầu nhưng giữ phần mở rộng do người gửi đặt. Tệp bắt đầu bằng `%PDF` chứa HTML được lưu dưới đuôi `.html`, rồi máy chủ phục vụ bằng `text/html`. Phiếu in cũng chèn nguyên ghi chú/tên/địa chỉ vào HTML. Đã xác minh cả phản hồi HTML của tệp và phiếu in giữ nguyên thẻ script thử nghiệm. Khi cán bộ mở nội dung này, trình duyệt có thể chạy mã cùng nguồn ứng dụng; chưa thực hiện hành vi lấy dữ liệu thật.

Khắc phục: xác định loại tệp thực và phần mở rộng phía máy chủ, kiểm tra cấu trúc tệp, mã hóa nội dung theo ngữ cảnh HTML và kiểm soát cách trình duyệt mở tệp. Thử cả đường upload lẫn phiếu in.

### R04 — P0: Sao lưu mất giao dịch đã lưu nhưng vẫn báo thành công

Vị trí: `src/db/database.js:30`; `scripts/backup.js:33`; `scripts/restore.js:62`.

SQLite đang bật WAL; script chỉ sao chép `qlttxd.db`. Dữ liệu đã commit còn trong WAL không vào bản sao. Tái hiện bằng một bảng thử: trước sao lưu có 1 bản ghi, phục hồi sạch còn 0, `integrity_check` vẫn “ok”. Kiểm tra cấu trúc CSDL không chứng minh đủ hồ sơ.

Khắc phục: dùng cơ chế sao lưu nhất quán của CSDL; phối hợp DB/tệp và kiểm đếm đối soát sau phục hồi. Bổ sung diễn tập trên môi trường sạch và kiểm tra tệp liên quan. Câu thông báo “RPO đạt ≤24h” hiện chỉ là chuỗi in sẵn; chưa có lịch, bản sao ngoài máy hay giám sát để chứng minh.

### R05 — P0: Đồng bộ xóa nháp dù chưa ghi phiếu; nộp trực tuyến báo thành công giả

Vị trí: `public/app.js:1194`, `:1205`, `:1248`, `:1261`; `src/server.js:308`, `:534`.

Giao diện gọi `/api/internal/permits/:id/inspections`, trong khi máy chủ chỉ có `/api/internal/inspections`. Tên trường gửi cũng khác: `actual_*`, `stage` thay cho `measured_*`, `stage_index` và thiếu `permit_id` trong body. Có phiên hợp lệ thì URL sai rơi xuống trang HTML dự phòng HTTP 200. Giao diện chỉ kiểm tra `res.ok`, báo thành công và xóa nháp. Đã xác minh qua HTTP: 200 HTML nhưng không thêm phiếu; kiểm tra giao diện giả lập xác nhận nhánh này xóa nháp.

Ngoài ra `appSaveOfflineInspection` không giữ hai ô khoảng lùi đã nhập (`public/app.js:1228`).

Khắc phục: thống nhất hợp đồng API; URL API không tồn tại phải trả lỗi JSON; chỉ xóa nháp sau xác nhận JSON hợp lệ có ID phiếu đã lưu; giữ đầy đủ chỉ tiêu. Kiểm thử từ thao tác người dùng đến bản ghi máy chủ.

### R06 — P1: Duyệt thiếu mốc và ảnh vẫn hoàn thành công trình

Vị trí: `src/services/inspections.js:37`, `:58`, `:95`.

Tiến độ tính bằng giá trị lớn nhất của mốc hiện tại và mốc vừa duyệt. Không xác minh đủ các mốc trước, ảnh thật hoặc trạng thái có được phép duyệt lại. Đã tái hiện chỉ mốc 4, 0 ảnh vẫn hoàn thành. Duyệt lại cũng có thể ghi đè trạng thái “Tạm dừng” do vi phạm. Ảnh nhận từ client có thể dùng tên/kích thước/hash giả, kể cả `dummy_hash`.

Khắc phục: kiểm tra quy trình chuyển trạng thái, đủ mốc, điều kiện tạm dừng, quyền và ảnh đã lưu; không cho phê duyệt lại tùy ý. Ô số đo bỏ trống phải giữ “chưa đo”, không biến chuỗi rỗng thành 0.

### R07 — P1: Khóa chống gửi trùng không có tác dụng cho phiếu kiểm tra

Vị trí: `src/server.js:308`; `src/services/inspections.js:25`; `tests/offline_sync.test.js:53`.

Route phiếu không đọc Idempotency-Key. Đã gửi hai request giống nhau, cùng khóa: tạo hai phiếu khác ID. Test ngoại tuyến hiện tự chèn và đọc bảng khóa, không thực sự gửi lại qua API, nên không bắt được lỗi.

Khắc phục: ghi khóa, nội dung yêu cầu và kết quả trong giao dịch; kiểm tra phạm vi người gửi/endpoint/nội dung; kiểm thử việc mất phản hồi rồi gửi lại qua HTTP. Phản ánh hiện cũng tra khóa toàn cục mà chưa so nội dung hay người gửi (`complaints.js:43`).

### R08 — P1: Giao diện cán bộ chưa có đăng nhập thật

Vị trí: `public/app.js:12`, `:934`.

Mặc định giao diện là admin; nút đổi vai trò chỉ thay trạng thái giao diện. Không có lời gọi login/logout/me trong mã giao diện hiện tại. Trình duyệt mới chưa có cookie không thể thực hiện nghiệp vụ nội bộ; API trả 401. Đây là thiếu luồng đăng nhập, không có nghĩa bấm đổi vai trò đã tự tạo phiên quản trị.

Khắc phục: tích hợp đăng nhập, TOTP, lấy vai trò từ máy chủ, đăng xuất và xử lý hết phiên; không suy ra quyền từ trạng thái cục bộ.

### R09 — P1: Hiển thị sai địa chỉ, tiến độ và mốc kiểm tra

Vị trí: `public/app.js:299`, `:360`, `:437`, `:449`, `:454`, `:1142`.

API trả `site_address`, `current_stage`, nhưng giao diện còn đọc `place`, `done`, `checked`. Dữ liệu không được chuyển đổi khi nạp. Trong phép thử giao diện giả lập, hồ sơ ở mốc 3 hiện 0/4 và địa chỉ chung của phường. Tìm địa chỉ và chọn mốc phiếu vì vậy cũng sai.

Khắc phục: dùng thống nhất mô hình dữ liệu hoặc một hàm chuyển đổi rõ ràng; kiểm tra hồ sơ mẫu có các mốc khác nhau bằng toàn bộ luồng giao diện.

### R10 — P1: Người dân nhận mã tra cứu giữ chỗ thay vì mã thật

Vị trí: `public/app.js:887`; `src/services/complaints.js:103`.

Máy chủ trả `lookup_code`, giao diện đọc `tracking_code` rồi hiện `TN-DEMO-XXXX`. Đã kiểm tra bằng phản hồi chứa mã thật: thông báo vẫn là mã giữ chỗ. Người dân không thể dùng mã được hiển thị để tra cứu phản ánh vừa gửi.

Khắc phục: hiển thị và cho lưu mã thật, có màn hình tra cứu mã người dùng nhập; bỏ lời gọi tra cứu mã mẫu cố định ở `public/app.js:304`.

### R11 — P1: Một Cookie sai định dạng làm dừng máy chủ

Vị trí: `src/server.js:51`, `:142`, `:148`.

Giải mã cookie nằm ngoài khối bắt lỗi. Đã gửi `session_id=%` đến máy chủ localhost thử nghiệm: URIError không được xử lý, tiến trình thoát mã 1. Không cần tài khoản.

Khắc phục: bao toàn bộ khâu đọc URL/cookie/session trong xử lý lỗi; trả lỗi đầu vào hợp lệ và giữ tiến trình hoạt động. Thêm phép thử request tiếp theo vẫn thành công.

### R12 — P1: Bỏ qua màn hình xem trước vẫn nhập được dữ liệu sai

Vị trí: `src/services/batch_import.js:303`; `src/server.js:388` route `/api/internal/batch-import/commit`.

Bước commit nhận trực tiếp các dòng client gửi và INSERT, không chạy lại quy tắc kiểm tra của bước preview. Phép thử độc lập nhận ngày không hợp lệ, diện tích âm, số tầng âm và tọa độ 999/999. CSDL thiếu CHECK cho các chỉ tiêu này.

Khắc phục: máy chủ phải xác thực lại dữ liệu lúc ghi hoặc chỉ commit lô đã lưu/đối soát phía máy chủ; bổ sung ràng buộc và migration tương ứng.

### R13 — P1: Hồ sơ mới tự công khai, thiếu bước duyệt

Vị trí: `src/services/permits.js:131`; `src/services/batch_import.js:319`; `src/db/schema.sql:44`.

Tạo tay và nhập lô đều ghi `is_public=1`; không có luồng công bố/thu hồi theo phiên bản. Dữ liệu chưa được rà soát vẫn xuất hiện trong API công khai, kể cả nội dung tự do trong địa chỉ/loại công trình.

Khắc phục: mặc định riêng tư, có người duyệt và dấu vết công bố/thu hồi. Bộ trường cho phép phải đi cùng việc duyệt đối tượng và nội dung từng trường.

### R14 — P0: Gộp phản ánh làm lộ mã bí mật của người khác

Vị trí: `src/services/complaints.js:322`, `:129`.

Thông báo gộp chèn `target.lookup_code` vào phản hồi của phản ánh nguồn. Người gửi nguồn tra cứu phản ánh của mình sẽ nhận mã để đọc hồ sơ đích của người khác. Rà soát độc lập đã xác minh đường dữ liệu này. Ngoài ra lookup trả `official_reply` không lọc trạng thái duyệt.

Khắc phục: chỉ trả mã tham chiếu không cấp quyền, mỗi người tiếp tục dùng mã riêng; lọc phản hồi theo trạng thái được phép công bố.

### R15 — P2: Phép đo tải tuyên bố đạt dù có yêu cầu thất bại

Vị trí: `tests/load_benchmark.js:100`, `:147`, `:152`.

Chỉ các request thành công vào `allLatencies`; cuối cùng lấy độ dài mảng này làm cả tử và mẫu. Số lỗi không quyết định kết quả. Cố ý làm 50 request lookup trả lỗi: vẫn thông báo 100%, 250/250, thoát mã 0.

Khắc phục: giữ tổng số request đã gửi, buộc thất bại khi có lỗi hoặc sai nội dung phản hồi, đo từng luồng với dữ liệu và hạ tầng đúng điều kiện kế hoạch. Không gọi kết quả hiện tại là đạt chuẩn mốc C.

## 5. Đối chiếu với kế hoạch và điều kiện hoàn thành

| Hạng mục | Đánh giá hiện tại | Điều kiện còn thiếu |
|---|---|---|
| Nền tảng và tài liệu F01–F12 | Có khung API, SQL, seed, đặc tả | Chưa thấy CI, hướng dẫn dựng/vận hành hoàn chỉnh, nhật ký phát hành và bằng chứng duyệt phạm vi trong repo |
| Mốc A: quyền và dữ liệu công khai | Chưa đạt | R01–R03, R08, R13, R14 |
| Mốc A: phản ánh và kiểm tra | Chưa đạt | R05–R10; chưa có luồng ảnh phản ánh hoàn chỉnh, lưu nháp máy chủ và quy trình đủ các trạng thái theo đặc tả |
| Mốc A: GIS và hồ sơ phiên bản | Một phần | Có GeoJSON và hàm tính không gian; chưa có lưu/duyệt ranh công trình theo phiên bản, chưa có bằng chứng đối soát nguồn/hệ tọa độ |
| Chống ghi đè phiên bản | Chưa đạt | `version_id` chỉ được tăng; UPDATE không kiểm phiên bản người dùng đã đọc (`permits.js:169`). Chưa có cơ chế trả xung đột và giữ phiên bản giấy phép/phiếu in bất biến |
| Mốc A: sao lưu và phục hồi | Không đạt | R04; thiếu lịch hàng ngày, bản sao ngoài máy, mã hóa và bằng chứng đối soát DB+tệp |
| Mốc B | Có một số dịch vụ | Nhập lô, gộp trùng, vi phạm, thống kê đã có mã nhưng còn lỗi quyền/toàn vẹn; không đủ căn cứ coi hoàn tất cả B |
| Mốc C | Có phần mã ngoại tuyến và QR | Đồng bộ đang có lỗi mất nháp; chưa có bằng chứng ngoại tuyến với ảnh/thiết bị thật. Không nên ghi hoàn tất mốc C |
| Máy chủ sản xuất | Chưa đúng kiến trúc bắt buộc | Mã chỉ kết nối SQLite; Docker production cũng dùng SQLite, chưa có PostgreSQL/PostGIS |
| Kiểm thử và nghiệm thu | Một phần | 38 test đạt khi có seed nhưng bỏ lọt các lỗi nêu trên; chưa có kiểm thử HTTP đầy đủ vai trò, giao diện đầu-cuối và diễn tập phục hồi đạt |
| Ngân sách và mốc thời gian | Chưa đủ dữ liệu đánh giá chi tiêu | Repo không chứng minh khoản đã chi, hạ tầng được phép, người vận hành hoặc quyết định dùng dữ liệu thật |

Lựa chọn giao diện hiện là JavaScript/Leaflet và nền Google/Esri, khác đề xuất TypeScript/MapLibre của kế hoạch. Một thay đổi công cụ không tự động là lỗi, nhưng cần ghi nhận quyết định, điều kiện sử dụng nguồn nền và kiểm thử thay thế; không có căn cứ trong đợt này để xác nhận các phê duyệt đó. Không đánh đồng SQLite được phép ở môi trường phát triển với đáp ứng yêu cầu PostGIS khi triển khai sản xuất.

## 6. Mã thừa, mã mẫu còn sót và nợ kỹ thuật

| Vị trí | Nhận xét | Xử lý phù hợp |
|---|---|---|
| `src/server.js:23` | Biến `PORT` không được dùng; bên dưới tính `currentPort` riêng | Bỏ biến thừa hoặc dùng một nguồn cấu hình |
| `src/db/seed.js:4`, `src/services/auth.js:6` | Trùng hàm băm mật khẩu; cùng SHA-256 và salt cố định | Dùng một mô-đun xác thực; xử lý chuyển đổi mật khẩu có migration, không chỉ dọn dòng trùng |
| `src/db/seed.js:19`, Dockerfile | Tài khoản/mật khẩu/TOTP mẫu đặt cứng; Docker chạy seed và sao chép thư mục data | Tách seed demo khỏi vận hành thật và cấp tài khoản có kiểm soát |
| `public/app.js:304` | Tra cứu mã phản ánh mẫu cố định, tiếp theo gọi thống kê nhưng kết quả không phục vụ danh sách phản ánh | Xóa sau khi thay bằng luồng tra cứu thật |
| `public/app.js:770` | URL nhật ký sai: `/api/internal/reports/audit-logs`, máy chủ dùng `/api/internal/audit-logs` | Sửa route; hiển thị lỗi thật thay vì bảng rỗng |
| `public/d3.v7.min.js` | Không còn tham chiếu từ giao diện hiện tại | Ứng viên loại khỏi gói triển khai; xác nhận không dùng bản mẫu trước xóa |
| `public/sw.js` | Có tệp worker nhưng không tìm thấy đăng ký worker trong mã giao diện hiện tại | Không coi việc có tệp là PWA ngoại tuyến đã hoạt động; xác minh cài đặt/cập nhật/cache trên trình duyệt |
| `tests/load_benchmark.js:124` | Tính p99 nhưng không sử dụng | Bỏ hoặc đưa vào báo cáo nếu có mục tiêu đo |
| `src/db/database.js:42` | ALTER TABLE và catch rỗng mỗi lần khởi tạo | Dùng migration có phiên bản; chỉ xử lý lỗi dự kiến, không nuốt mọi lỗi |
| `src/services/reports.js:15`, `:72` | Nuốt lỗi truy vấn và tiếp tục trả dữ liệu thiếu | Ghi nhận lỗi và trả trạng thái rõ; tránh báo cáo trông như không có vụ việc |
| `data/qlttxd.db`, `.gitignore` | CSDL làm việc được Git theo dõi; test có thể ghi vào đây nếu chạy tại repo | Tách DB thử theo từng lượt, tự seed; không đưa dữ liệu nghiệp vụ/phiên vào lịch sử mã |

Không coi mọi comment, biến dự phòng hoặc tệp mẫu là “rác”. Ví dụ `Ban_mau_UI_Thao_Nguyen.html` có thể là tài liệu tham chiếu; cần giữ nếu còn phục vụ thiết kế. Cũng không kết luận đã rò dữ liệu thật qua Git: đợt kiểm tra chỉ xác nhận tệp DB đang được theo dõi.

## 7. Thứ tự khắc phục và kiểm chứng lại

1. **Khóa các đường rò rỉ/sai quyền và bảo toàn dữ liệu:** quyền nội bộ/tệp, HTML nguy hiểm, mã tra cứu khi gộp, sao lưu và xóa nháp sai.
2. **Khôi phục luồng mốc A:** đăng nhập thật; hợp đồng dữ liệu giao diện/API; mã tra cứu; mốc kiểm tra, ảnh và quy trình duyệt; chống gửi trùng; đầu vào sai không làm dừng máy chủ.
3. **Hoàn thiện toàn vẹn và triển khai:** validation lúc commit, công bố có duyệt, phiên bản chống ghi đè, migrations/changelog và cấu hình sản xuất theo kiến trúc đã chốt.
4. **Kiểm tra lại bằng ca tái hiện lỗi:** mỗi lỗi có test ở đúng tầng HTTP/giao diện; DB/tệp biệt lập; chạy toàn bộ test và diễn tập phục hồi có đối soát.
5. **Chốt nghiệm thu A rồi mới mở rộng:** cập nhật bảng tiến độ theo bằng chứng, ghi riêng phần B/C chưa đạt; dọn mã thừa sau các lỗi ảnh hưởng quyền và hồ sơ.

Không đề xuất ngày hoàn thành sửa chữa khi chưa thống nhất phạm vi và nguồn lực. Điều kiện mở thí điểm dữ liệu thật vẫn là không còn P0/P1, phục hồi đã kiểm chứng và có xác nhận dữ liệu/nghiệp vụ/hạ tầng của đơn vị.
