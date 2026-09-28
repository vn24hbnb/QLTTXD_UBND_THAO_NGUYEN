import crypto from 'node:crypto';
import dbService from '../db/database.js';
import { validatePermit, createPermit } from './permits.js';
import { fail, text, requireStaff, idempotent, audit } from './validation.js';

/**
 * Trình phân tích RFC 4180 CSV thuần Node.js
 */
export function parseCsv(text) {
  if (!text || typeof text !== 'string') return { headers: [], rows: [] };

  // Xóa UTF-8 BOM nếu có
  const cleanText = text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;

  // Excel may export a semicolon-separated CSV in Vietnamese locales.
  const separators = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (let i = 0; i < cleanText.length; i++) {
    const c = cleanText[i];
    if (c === '"') {
      if (quoted && cleanText[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted) {
      if (c === '\r' || c === '\n') break;
      if (c in separators) separators[c]++;
    }
  }
  const delimiter = Object.keys(separators).sort((a, b) => separators[b] - separators[a])[0];
  const rows = [];
  let currentRow = [];
  let currentVal = '';
  let inQuotes = false;

  for (let i = 0; i < cleanText.length; i++) {
    const char = cleanText[i];
    const nextChar = cleanText[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentVal += '"';
        i++; // Bỏ qua ký tự thoát nháy kép tiếp theo
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      currentRow.push(currentVal.trim());
      currentVal = '';
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') {
        i++;
      }
      currentRow.push(currentVal.trim());
      currentVal = '';
      if (currentRow.some(c => c.length > 0)) {
        rows.push(currentRow);
      }
      currentRow = [];
    } else {
      currentVal += char;
    }
  }

  if (inQuotes) fail('CSV có dấu nháy chưa được đóng');
  if (currentVal.length > 0 || currentRow.length > 0) {
    currentRow.push(currentVal.trim());
    if (currentRow.some(c => c.length > 0)) {
      rows.push(currentRow);
    }
  }

  if (rows.length === 0) return { headers: [], rows: [] };

  const headers = rows[0].map(h => h.toLowerCase().replace(/['"]/g, ''));
  const dataRows = rows.slice(1);

  return { headers, rows: dataRows };
}

export function removeDiacritics(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

/**
 * Ánh xạ tiêu đề cột tiếng Việt hoặc tiếng Anh sang tên trường chuẩn
 */
const HEADER_ALIASES = {
  permit_number: ['Số giấy phép', 'Số GPXD', 'permitnum'], issue_date: ['Ngày cấp'],
  issuing_authority: ['Cơ quan cấp', 'Cơ quan cấp phép', 'authority'],
  owner_name: ['Chủ hộ', 'Chủ đầu tư', 'Tên chủ đầu tư'],
  owner_address: ['Địa chỉ chủ hộ', 'Địa chỉ chủ đầu tư'],
  site_address: ['Địa điểm', 'Địa điểm xây dựng', 'Địa chỉ', 'Địa chỉ công trình'],
  construction_type: ['Loại công trình', 'type'],
  land_area: ['DT đất', 'Diện tích đất'], building_area: ['DT xây dựng', 'Diện tích xây dựng'],
  total_floor_area: ['Tổng DT sàn', 'Tổng diện tích sàn', 'floorsarea', 'totalfloor'],
  land_use_ratio: ['Hệ số sử dụng đất'], floors_text: ['Số tầng', 'Số tầng theo giấy phép', 'Quy mô tầng', 'floors'],
  confirmed_floors: ['Số tầng xác nhận'], basement_floors: ['Số tầng hầm'], mezzanine_floors: ['Số tầng lửng'],
  building_height: ['Chiều cao công trình', 'Chiều cao'], building_density: ['Mật độ xây dựng'],
  setback_text: ['Khoảng lùi', 'setback'], red_line_setback: ['Chỉ giới đường đỏ'], construction_boundary: ['Chỉ giới xây dựng'],
  ground_elevation: ['Cốt nền'], exterior_color: ['Màu sắc công trình', 'Màu sắc'], land_lot: ['Thửa đất'],
  design_by: ['Đơn vị thiết kế'], design_doc: ['Hồ sơ thiết kế'], land_use_cert: ['Giấy tờ đất'],
  expiration_date: ['Ngày hết hạn'], longitude: ['Kinh độ', 'lng'], latitude: ['Vĩ độ', 'lat'], commune_code: ['Mã địa bàn']
};
const headerKey = value => removeDiacritics(value).toLowerCase().replace(/\([^)]*\)/g, '').replace(/m[²2]/g, '').replace(/[\s_/%²-]/g, '');
const HEADER_FIELDS = new Map(Object.entries(HEADER_ALIASES).flatMap(([field, aliases]) => [field, ...aliases].map(alias => [headerKey(alias), field])));
const NUMERIC_FIELDS = ['land_area','building_area','total_floor_area','land_use_ratio','confirmed_floors','basement_floors','mezzanine_floors','building_height','building_density','longitude','latitude'];
export function mapHeaderToField(header) {
  return HEADER_FIELDS.get(headerKey(header)) || header;
}

/**
 * Chuẩn hóa định dạng ngày sang YYYY-MM-DD
 */
export function normalizeDate(dateStr) {
  if (!dateStr) return null;
  const str = String(dateStr).trim();

  // Dạng YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return str;
  }

  // Dạng DD/MM/YYYY
  const parts = str.split(/[/-]/);
  if (parts.length === 3) {
    if (parts[0].length === 4) {
      // YYYY/MM/DD
      return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
    } else if (parts[2].length === 4) {
      // DD/MM/YYYY
      return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
    }
  }

  return str;
}

/** Preview and commit share the same server-side validation. */
export async function previewBatch(csvContent) {
  const {headers,rows}=parseCsv(csvContent);
  if (!headers.length || !rows.length) return {success:false,totalRows:0,validCount:0,errorCount:0,errors:[{row:1,field:'csv',message:'Tệp CSV trống'}],previewRows:[]};
  if (rows.length>1000) fail('Mỗi lô chỉ nhận tối đa 1.000 hồ sơ');
  const fields=headers.map(mapHeaderToField);
  const unknown = headers.filter((header, i) => !Object.hasOwn(HEADER_ALIASES, fields[i]));
  if (unknown.length) fail('Không nhận diện được cột: ' + unknown.join(', ') + '. Hãy dùng tệp mẫu.');
  if(new Set(fields).size!==fields.length) fail('Tệp có cột trùng hoặc nhiều cột cùng ý nghĩa');
  const existing=new Set((await dbService.all('SELECT permit_number FROM permits')).map(p=>p.permit_number.toUpperCase()));
  const seen=new Set();
  const previewRows=rows.map((row,index)=>{
    let data=Object.fromEntries(fields.map((field,i)=>[field,row[i]??'']));
    const errors=[];
    try {
      if(row.length!==fields.length) fail('Số ô không khớp tiêu đề CSV');
      data.issue_date=normalizeDate(data.issue_date);
      data.expiration_date=normalizeDate(data.expiration_date);
      for (const field of NUMERIC_FIELDS) {
        if (typeof data[field] === 'string' && /^-?\d+,\d+$/.test(data[field])) data[field] = data[field].replace(',', '.');
      }
      data=validatePermit(data);
      if(data.longitude==null) fail('Thiếu tọa độ công trình');
      const normalized=data.permit_number.toUpperCase();
      if(existing.has(normalized)||seen.has(normalized)) fail('Số giấy phép đã tồn tại hoặc trùng trong tệp');
      seen.add(normalized);
    } catch(error) { errors.push({field:'record',message:error.message}); }
    return {rowNumber:index+2,isValid:errors.length===0,errors,data};
  });
  const errors=previewRows.flatMap(row=>row.errors.map(error=>({row:row.rowNumber,...error})));
  const validCount=previewRows.filter(row=>row.isValid).length;
  return {success:true,totalRows:rows.length,validCount,errorCount:rows.length-validCount,errors,previewRows};
}
export async function commitBatch(validRows,userId,filename='import.csv',idempotencyKey=null) {
  await requireStaff(userId,['admin','coordinator']);
  if(!Array.isArray(validRows)||!validRows.length||validRows.length>1000) fail('Lô nhập phải có từ 1 đến 1.000 hồ sơ');
  const safeFilename=text(filename,'tên tệp',{required:true,max:255});
  const rows=validRows.map(item=>validatePermit(item?.data??item));
  const seen=new Set();
  for(const row of rows) {
    if(row.longitude==null) fail('Thiếu tọa độ công trình');
    const key=row.permit_number.toUpperCase();
    if(seen.has(key)) fail('Số giấy phép trùng trong lô nhập');
    seen.add(key);
  }
  return idempotent('/api/internal/batch-import/commit',userId,idempotencyKey,{rows,filename:safeFilename},async db=>{
    const batchId=`batch-${crypto.randomUUID()}`;
    const permits=[];
    for(const row of rows) {
      if(await db.get('SELECT id FROM permits WHERE UPPER(permit_number) = ?',[row.permit_number.toUpperCase()])) fail('Số giấy phép đã tồn tại',409);
      const permit=await createPermit(row,userId);
      permits.push({id:permit.id,permit_number:permit.permit_number});
    }
    await db.run("INSERT INTO import_batches (id,user_id,filename,total_rows,valid_rows,error_rows,status,created_at) VALUES (?,?,?,?,?,0,'committed',?)",[batchId,userId,safeFilename,rows.length,rows.length,new Date().toISOString()]);
    await audit(db,userId,'COMMIT_BATCH_IMPORT','import_batches',batchId,{filename:safeFilename,count:permits.length});
    return {success:true,batchId,importedCount:permits.length,permits};
  });
}
export default {parseCsv,mapHeaderToField,normalizeDate,previewBatch,commitBatch};
