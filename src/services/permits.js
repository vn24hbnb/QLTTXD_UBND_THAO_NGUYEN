import crypto from 'node:crypto';
import dbService from '../db/database.js';
import { text, number, date, coordinates, expectedVersion, audit, fail, requireStaff } from './validation.js';

const PUBLIC_COLUMNS = 'id, permit_number, site_address, construction_type, building_area, total_floor_area, floors_text, confirmed_floors, building_height, red_line_setback, construction_boundary, setback_text, status, current_stage, longitude, latitude, updated_at';
export function validatePermit(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('Dữ liệu giấy phép không hợp lệ');
  return {
    permit_number: text(data.permit_number, 'số giấy phép', { required: true, max: 200 }),
    issue_date: date(data.issue_date, 'ngày cấp', { required: true }),
    issuing_authority: text(data.issuing_authority, 'cơ quan cấp phép', { required: true, max: 500 }),
    owner_name: text(data.owner_name, 'tên chủ đầu tư', { required: true, max: 500 }),
    owner_address: text(data.owner_address, 'địa chỉ chủ đầu tư', { max: 2000 }),
    construction_type: text(data.construction_type, 'loại công trình', { required: true, max: 500 }),
    site_address: text(data.site_address, 'địa chỉ công trình', { required: true, max: 2000 }),
    land_area: number(data.land_area, 'diện tích đất'),
    building_area: number(data.building_area, 'diện tích xây dựng'),
    total_floor_area: number(data.total_floor_area, 'tổng diện tích sàn'),
    land_use_ratio: number(data.land_use_ratio, 'hệ số sử dụng đất'),
    floors_text: text(data.floors_text, 'quy mô tầng', { max: 500 }),
    confirmed_floors: number(data.confirmed_floors, 'số tầng', { integer: true, max: 300 }),
    setback_text: text(data.setback_text, 'khoảng lùi', { max: 1000 }),
    ...coordinates(data.longitude, data.latitude),
    commune_code: text(data.commune_code, 'mã địa bàn', { max: 20 }) || '03982',
    basement_floors: number(data.basement_floors,'số tầng hầm',{integer:true,max:30}),
    mezzanine_floors: number(data.mezzanine_floors,'số tầng lửng',{integer:true,max:100}),
    building_height: number(data.building_height,'chiều cao công trình',{max:1000}),
    building_density: number(data.building_density,'mật độ xây dựng',{max:100}),
    red_line_setback: text(data.red_line_setback,'chỉ giới đường đỏ',{max:2000}),
    construction_boundary: text(data.construction_boundary,'chỉ giới xây dựng',{max:2000}),
    ground_elevation: text(data.ground_elevation,'cốt nền',{max:1000}),
    exterior_color: text(data.exterior_color,'màu sắc công trình',{max:1000}),
    land_lot: text(data.land_lot,'thửa đất',{max:1000}),
    design_by: text(data.design_by,'đơn vị thiết kế',{max:1000}),
    design_doc: text(data.design_doc,'hồ sơ thiết kế',{max:2000}),
    land_use_cert: text(data.land_use_cert,'giấy tờ đất',{max:2000}),
    expiration_date: date(data.expiration_date,'ngày hết hạn')
  };
}
async function listPermits(isInternal, { query = '', status = 'all', limit = 100, offset = 0 } = {}) {
  let sql = `SELECT ${isInternal ? '*' : PUBLIC_COLUMNS} FROM permits WHERE ${isInternal ? '1=1' : 'is_public = 1'}`;
  const params = [];
  if (status && status !== 'all') {
    sql += ' AND status = ?';
    params.push(status === 'check' ? 'Cần kiểm tra' : status === 'done' ? 'Đã hoàn thành' : status);
  }
  if (query?.trim()) {
    sql += ` AND (permit_number LIKE ? OR site_address LIKE ?${isInternal ? ' OR owner_name LIKE ?' : ''})`;
    const search = `%${query.trim()}%`;
    params.push(search, search);
    if (isInternal) params.push(search);
  }
  sql += ' ORDER BY issue_date DESC, permit_number ASC LIMIT ? OFFSET ?';
  params.push(number(limit,'giới hạn',{integer:true,min:1,max:1000,required:true}),number(offset,'vị trí',{integer:true,required:true}));
  return dbService.all(sql, params);
}
export async function getPublicPermits(options) { return listPermits(false, options); }
export async function getInternalPermits(options) { return listPermits(true, options); }
export async function getPermitById(id, isInternal = false) {
  return dbService.get(`SELECT ${isInternal ? '*' : PUBLIC_COLUMNS} FROM permits WHERE id = ?${isInternal ? '' : ' AND is_public = 1'}`, [id]);
}
export async function createPermit(data, userId) {
  await requireStaff(userId,['admin','coordinator']);
  const d = validatePermit(data);
  const id = `permit-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const status = d.longitude == null ? 'Chờ xác nhận vị trí' : 'Cần kiểm tra';
  return dbService.transaction(async db => {
    const columns = Object.keys(d);
    await db.run(`INSERT INTO permits (id,${columns.join(',')},status,current_stage,version_id,is_public,created_at,updated_at) VALUES (${Array(columns.length+7).fill('?').join(',')})`,[id,...Object.values(d),status,0,1,0,now,now]);
    await audit(db,userId,'CREATE_PERMIT','permits',id,{permit_number:d.permit_number,is_public:false});
    return getPermitById(id,true);
  });
}
export async function preservePermitHistory(db, permit, userId, reason) {
  await db.run('INSERT INTO permit_history (id,permit_id,version_id,snapshot_json,change_reason,user_id,created_at) VALUES (?,?,?,?,?,?,?)',[crypto.randomUUID(),permit.id,permit.version_id,JSON.stringify(permit),reason,userId,new Date().toISOString()]);
}
export async function updatePermitStatus(id, { status, current_stage, version_id, reason }, userId) {
  const actor=await requireStaff(userId);
  return dbService.transaction(async db => {
    const permit = await getPermitById(id,true);
    if (!permit) fail('Không tìm thấy hồ sơ',404);
    expectedVersion(version_id,permit.version_id);
    const nextStatus = status ?? permit.status;
    const nextStage = current_stage == null ? permit.current_stage : number(current_stage,'mốc hoàn thành',{integer:true,max:4,required:true});
    if (!['Cần kiểm tra','Đang thi công','Đã hoàn thành','Chờ xác nhận vị trí','Tạm dừng'].includes(nextStatus)) fail('Trạng thái công trình không hợp lệ');
    if (actor.role === 'inspector' && (nextStatus !== 'Tạm dừng' || nextStage !== permit.current_stage)) fail('Chỉ người điều phối được thay đổi trạng thái này',403);
    if (nextStage !== permit.current_stage) {
      const approved = await db.all("SELECT DISTINCT stage_index FROM inspections WHERE permit_id = ? AND status = 'approved'",[id]);
      const approvedStages=new Set(approved.map(row=>Number(row.stage_index)));
      let actualStage=0; while(actualStage<4 && approvedStages.has(actualStage)) actualStage++;
      if(nextStage!==actualStage || nextStage<permit.current_stage) fail('Mốc hoàn thành chỉ thay đổi khi duyệt phiếu kiểm tra',409);
    }
    if (permit.status === 'Tạm dừng' && nextStatus !== 'Tạm dừng') {
      text(reason,'lý do cho phép tiếp tục thi công',{required:true,max:2000});
      const outstanding = await db.get("SELECT COUNT(*) AS count FROM violations WHERE permit_id = ? AND status != 'đã_khắc_phục'",[id]);
      if (Number(outstanding.count) > 0) fail('Phải xử lý hết vi phạm trước khi cho phép tiếp tục',409);
    }
    if (nextStatus === 'Đã hoàn thành') {
      const stages = await db.all("SELECT DISTINCT stage_index FROM inspections WHERE permit_id = ? AND status = 'approved'",[id]);
      if (stages.length !== 4 || nextStage !== 4) fail('Chỉ hoàn thành sau khi đủ 4 mốc được duyệt',409);
    }
    await preservePermitHistory(db,permit,userId,reason || 'Cập nhật trạng thái công trình');
    const result = await db.run('UPDATE permits SET status = ?,current_stage = ?,version_id = version_id + 1,updated_at = ? WHERE id = ? AND version_id = ?',[nextStatus,nextStage,new Date().toISOString(),id,version_id]);
    if (Number(result.changes ?? result.rowCount) !== 1) fail('Hồ sơ đã thay đổi',409,'VERSION_CONFLICT');
    await audit(db,userId,'UPDATE_PERMIT_STATUS','permits',id,{oldStatus:permit.status,newStatus:nextStatus,oldStage:permit.current_stage,newStage:nextStage});
    return getPermitById(id,true);
  });
}
export async function publishPermit(id, { version_id, is_public }, userId) {
  await requireStaff(userId,['admin','coordinator']);
  if (typeof is_public !== 'boolean') fail('Phải xác nhận trạng thái công bố');
  return dbService.transaction(async db => {
    const permit = await getPermitById(id,true);
    if (!permit) fail('Không tìm thấy hồ sơ',404);
    expectedVersion(version_id,permit.version_id);
    if (is_public && permit.longitude == null) fail('Phải xác nhận vị trí trước khi công bố');
    await preservePermitHistory(db,permit,userId,is_public?'Công bố hồ sơ':'Ngừng công bố hồ sơ');
    const result = await db.run('UPDATE permits SET is_public = ?,version_id = version_id + 1,updated_at = ? WHERE id = ? AND version_id = ?',[is_public?1:0,new Date().toISOString(),id,version_id]);
    if (Number(result.changes ?? result.rowCount) !== 1) fail('Hồ sơ đã thay đổi',409,'VERSION_CONFLICT');
    await audit(db,userId,'PUBLISH_PERMIT','permits',id,{oldValue:permit.is_public,newValue:is_public});
    return getPermitById(id,true);
  });
}
export async function resumePermit(id,{version_id,reason},userId) {
  await requireStaff(userId,['admin','coordinator']);
  const changeReason=text(reason,'lý do cho phép tiếp tục thi công',{required:true,max:2000});
  return dbService.transaction(async db=>{
    const permit=await getPermitById(id,true);
    if(!permit) fail('Không tìm thấy hồ sơ',404);
    expectedVersion(version_id,permit.version_id);
    if(permit.status!=='Tạm dừng') fail('Công trình không ở trạng thái tạm dừng',409);
    const violations=await db.get("SELECT COUNT(*) AS count FROM violations WHERE permit_id = ? AND status != 'đã_khắc_phục'",[id]);
    if(Number(violations.count)>0) fail('Phải xử lý hết vi phạm trước khi cho phép tiếp tục',409);
    const status=permit.longitude==null?'Chờ xác nhận vị trí':permit.current_stage===4?'Đã hoàn thành':permit.current_stage===0?'Cần kiểm tra':'Đang thi công';
    const result=await updatePermitStatus(id,{status,version_id,reason:changeReason},userId);
    await audit(db,userId,'RESUME_PERMIT','permits',id,{reason:changeReason,status});
    return result;
  });
}
export default {getPublicPermits,getInternalPermits,getPermitById,createPermit,updatePermitStatus,publishPermit,resumePermit};
