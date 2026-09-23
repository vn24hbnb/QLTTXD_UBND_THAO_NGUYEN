import dbService from './database.js';
import { hashPassword } from '../services/auth.js';
export { hashPassword } from '../services/auth.js';

// Synthetic local fixtures only. Never run against a deployed database.
export function seed() {
  if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL) throw new Error('Không nạp dữ liệu thử nghiệm vào máy chủ.');
  const db = dbService.getDb();
  if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n) {
    // Previous local demo seeds enabled TOTP for this synthetic account.
    // Clear it only for that exact fixture; leave every provisioned account alone.
    db.prepare("UPDATE users SET totp_secret = NULL WHERE id = 'usr-admin' AND username = 'admin' AND full_name = 'Tài khoản thử nghiệm admin' AND role = 'admin'").run();
    return;
  }
  const now = new Date().toISOString();
  db.exec('BEGIN IMMEDIATE');
  try {
    const insert = db.prepare('INSERT INTO users (id,username,password_hash,full_name,role,totp_secret,is_active,created_at) VALUES (?,?,?,?,?,?,1,?)');
    for (const [id,username,password,role] of [
      ['usr-admin','admin','admin123456','admin'],
      ['usr-inspector','inspector1','inspect123456','inspector'],
      ['usr-coordinator','coordinator1','coordinate123456','coordinator'],
      ['usr-citizen','citizen1','citizen123456','citizen']
    ]) insert.run(id,username,hashPassword(password),'Tài khoản thử nghiệm '+role,role,null,now);
  const basePermits = [
    { num: '018', type: 'Nhà ở riêng lẻ', place: 'Tổ dân phố 1, đường Lê Thanh Nghị', status: 'Cần kiểm tra', done: 1, coord: [104.688, 20.893], owner: 'Nguyễn Văn An', area: 120, totalFloor: 240, floors: '02 tầng', setback: 'Khoảng lùi 3 m' },
    { num: '021', type: 'Nhà ở riêng lẻ', place: 'Tổ dân phố 2, tiểu khu Thảo Nguyên', status: 'Cần kiểm tra', done: 2, coord: [104.696, 20.828], owner: 'Trần Đình Trọng', area: 150, totalFloor: 450, floors: '03 tầng', setback: 'Khoảng lùi 3.5 m' },
    { num: '027', type: 'Nhà ở riêng lẻ', place: 'Tổ dân phố 3, gần chợ Thảo Nguyên', status: 'Cần kiểm tra', done: 0, coord: [104.734, 20.87], owner: 'Lê Thị Thu', area: 95, totalFloor: 190, floors: '02 tầng', setback: 'Khoảng lùi 2.5 m' },
    { num: '009', type: 'Nhà ở riêng lẻ', place: 'Tổ dân phố 4, khu dân cư mới', status: 'Đã hoàn thành', done: 4, coord: [104.65, 20.922], owner: 'Phạm Hồng Sơn', area: 110, totalFloor: 330, floors: '03 tầng', setback: 'Khoảng lùi 3 m' },
    { num: '012', type: 'Nhà ở riêng lẻ', place: 'Tổ dân phố 5, ngõ 12 đường Hoàng Quốc Việt', status: 'Đã hoàn thành', done: 4, coord: [104.66, 20.854], owner: 'Vũ Thị Hạnh', area: 130, totalFloor: 260, floors: '02 tầng', setback: 'Khoảng lùi 3 m' },
    { num: '024', type: 'Nhà ở riêng lẻ', place: 'Tổ dân phố 6, dốc Bưu điện', status: 'Đang thi công', done: 1, coord: [104.7, 20.862], owner: 'Đỗ Mạnh Cường', area: 140, totalFloor: 420, floors: '03 tầng', setback: 'Khoảng lùi 4 m' },
    { num: '015', type: 'Nhà ở riêng lẻ', place: 'Tổ dân phố 7, gần trường Tiểu học', status: 'Đang thi công', done: 2, coord: [104.656, 20.894], owner: 'Bùi Thanh Vân', area: 125, totalFloor: 375, floors: '03 tầng', setback: 'Khoảng lùi 3 m' },
    { num: '025', type: 'Nhà ở riêng lẻ', place: 'Tổ dân phố 8, khu đồi Chè', status: 'Đang thi công', done: 1, coord: [104.712, 20.884], owner: 'Hoàng Quốc Việt', area: 160, totalFloor: 320, floors: '02 tầng', setback: 'Khoảng lùi 4 m' },

        { num: '029', type: 'Nhà ở riêng lẻ', place: 'Tổ dân phố 1, đường trục chính', status: 'Cần kiểm tra', done: 1, coord: [104.682, 20.890], owner: 'Lò Văn Kiên', area: 135, totalFloor: 270, floors: '02 tầng', setback: 'Khoảng lùi 3 m' },
    { num: '030', type: 'Công trình dịch vụ thương mại', place: 'Tổ dân phố 2, mặt đường QL43', status: 'Đang thi công', done: 2, coord: [104.698, 20.835], owner: 'Công ty TNHH Mộc Châu Xanh', area: 350, totalFloor: 1050, floors: '03 tầng', setback: 'Khoảng lùi 6 m' },
    { num: '031', type: 'Nhà ở riêng lẻ', place: 'Tổ dân phố 3, khu tái định cư', status: 'Cần kiểm tra', done: 0, coord: [104.725, 20.865], owner: 'Đặng Văn Lâm', area: 100, totalFloor: 300, floors: '03 tầng', setback: 'Khoảng lùi 3 m' },
    { num: '032', type: 'Nhà ở kết hợp kinh doanh', place: 'Tổ dân phố 4, ngã 3 Thảo Nguyên', status: 'Đang thi công', done: 3, coord: [104.662, 20.915], owner: 'Nguyễn Thị Bích', area: 180, totalFloor: 720, floors: '04 tầng', setback: 'Khoảng lùi 4 m' },
    { num: '033', type: 'Nhà ở riêng lẻ', place: 'Tổ dân phố 5, cụm dân cư số 2', status: 'Cần kiểm tra', done: 1, coord: [104.670, 20.860], owner: 'Vàng A Súa', area: 115, totalFloor: 230, floors: '02 tầng', setback: 'Khoảng lùi 3 m' },
    { num: '034', type: 'Nhà ở riêng lẻ', place: 'Tổ dân phố 6, ngõ 8 đường Thảo Nguyên', status: 'Đã hoàn thành', done: 4, coord: [104.705, 20.858], owner: 'Tạ Văn Thành', area: 120, totalFloor: 240, floors: '02 tầng', setback: 'Khoảng lùi 3 m' },
    { num: '035', type: 'Nhà ở riêng lẻ', place: 'Tổ dân phố 7, ven suối', status: 'Đang thi công', done: 2, coord: [104.660, 20.888], owner: 'Hà Thị Mười', area: 105, totalFloor: 210, floors: '02 tầng', setback: 'Khoảng lùi 5 m' },
    { num: '036', type: 'Nhà ở riêng lẻ', place: 'Tổ dân phố 8, khu vực đồi cao', status: 'Cần kiểm tra', done: 0, coord: [104.718, 20.878], owner: 'Nguyễn Tiến Dũng', area: 145, totalFloor: 290, floors: '02 tầng', setback: 'Khoảng lùi 4 m' },
    { num: '037', type: 'Nhà ở riêng lẻ', place: 'Tổ dân phố 1, ngõ 15', status: 'Đang thi công', done: 1, coord: [104.685, 20.898], owner: 'Đinh Công Toàn', area: 125, totalFloor: 375, floors: '03 tầng', setback: 'Khoảng lùi 3 m' },
    { num: '038', type: 'Nhà ở riêng lẻ', place: 'Tổ dân phố 2, tiểu khu 3', status: 'Đã hoàn thành', done: 4, coord: [104.692, 20.832], owner: 'Lê Văn Nam', area: 110, totalFloor: 220, floors: '02 tầng', setback: 'Khoảng lùi 3 m' },
    { num: '039', type: 'Nhà ở riêng lẻ', place: 'Tổ dân phố 3, khu vườn Mận', status: 'Đang thi công', done: 2, coord: [104.730, 20.872], owner: 'Trịnh Thị Lan', area: 130, totalFloor: 390, floors: '03 tầng', setback: 'Khoảng lùi 3 m' },
    { num: '040', type: 'Nhà ở riêng lẻ', place: 'Tổ dân phố 4, giáp ranh Vân Sơn', status: 'Cần kiểm tra', done: 1, coord: [104.648, 20.910], owner: 'Phan Văn Phú', area: 140, totalFloor: 280, floors: '02 tầng', setback: 'Khoảng lùi 3.5 m' },
    { num: '041', type: 'Nhà ở riêng lẻ', place: 'Tổ dân phố 5, dốc Đài Truyền thanh', status: 'Đang thi công', done: 2, coord: [104.665, 20.850], owner: 'Bùi Thị Dung', area: 118, totalFloor: 354, floors: '03 tầng', setback: 'Khoảng lùi 3 m' },
    { num: '042', type: 'Nhà ở riêng lẻ', place: 'Tổ dân phố 6, ven đồi Chè Ô Long', status: 'Chờ xác nhận vị trí', done: 0, coord: [0, 0], owner: 'Hoàng Văn Lập', area: 125, totalFloor: 250, floors: '02 tầng', setback: 'Khoảng lùi 3 m' }
  ];


    for (const [idx,p] of basePermits.entries()) {
      const row = {
        id:'permit-'+p.num, permit_number:'TEST-'+p.num+'/2026/GPXD', issue_date:'2026-09-01',
        issuing_authority:'Cơ quan thử nghiệm (không có giá trị pháp lý)', owner_name:'Chủ hộ thử nghiệm '+(idx+1),
        owner_address:'Địa chỉ cư trú giả lập',construction_type:p.type,site_address:p.place,
        land_area:180,building_area:p.area,total_floor_area:p.totalFloor,land_use_ratio:1.5,
        floors_text:p.floors,confirmed_floors:parseInt(p.floors),building_height:7.8,
        setback_text:p.setback,red_line_setback:'Chỉ giới mẫu',construction_boundary:'Ranh giới mẫu',
        ground_elevation:'Cốt nền mẫu',building_density:66.7,land_lot:'Thửa mẫu',
        design_by:'Đơn vị thiết kế giả lập',design_doc:'Bản vẽ mẫu',land_use_cert:'Giấy tờ đất giả lập',expiration_date:'2027-09-01',
        status:p.status,current_stage:p.done,longitude:p.coord[0]||null,latitude:p.coord[1]||null,
        commune_code:'03982',version_id:1,is_public:p.coord[0]?1:0,created_at:now,updated_at:now
      };
      const columns=Object.keys(row);
      db.prepare('INSERT INTO permits ('+columns.join(',')+') VALUES ('+columns.map(()=>'?').join(',')+')').run(...Object.values(row));
    }
    db.exec('COMMIT');
  } catch(error) { db.exec('ROLLBACK'); throw error; }
}
if (process.argv[1]?.endsWith('/seed.js')) { seed(); console.log('Đã tạo dữ liệu giả lập cục bộ; không dùng cho hồ sơ thật.'); }
export default seed;
