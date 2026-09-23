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
    } else if (char === ',' && !inQuotes) {
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
export function mapHeaderToField(header) {
  const clean = removeDiacritics(header).toLowerCase().replace(/m²/gi, '').replace(/[\s_()/-]/g, '');


  if (clean.includes('sogiayphep') || clean.includes('permitnum')) return 'permit_number';
  if (clean.includes('ngaycap') || clean.includes('issuedate')) return 'issue_date';
  if (clean.includes('coquancap') || clean.includes('authority')) return 'issuing_authority';
  if (clean.includes('diachichuho') || clean.includes('diachichudautu') || clean.includes('owneraddress')) return 'owner_address';
  if (clean.includes('chuho') || clean.includes('ownername') || clean.includes('chudautu')) return 'owner_name';
  if (clean.includes('diadiem') || clean.includes('siteaddress') || clean.includes('diachi')) return 'site_address';
  if (clean.includes('loaicongtrinh') || clean.includes('type')) return 'construction_type';
  if (clean.includes('dtdat') || clean.includes('landarea')) return 'land_area';
  if (clean.includes('dtxaydung') || clean.includes('buildingarea')) return 'building_area';
  if (clean.includes('tongdtsan') || clean.includes('floorsarea') || clean.includes('totalfloor')) return 'total_floor_area';
  if (clean.includes('confirmedfloors') || clean.includes('sotangxacnhan')) return 'confirmed_floors';
  if (clean.includes('sotang') || clean.includes('floors')) return 'floors_text';
  if (clean.includes('khoanglui') || clean.includes('setback')) return 'setback_text';
  if (clean.includes('kinhdo') || clean.includes('lng') || clean.includes('longitude')) return 'longitude';
  if (clean.includes('vido') || clean.includes('lat') || clean.includes('latitude')) return 'latitude';

  return header;
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
  if(new Set(fields).size!==fields.length) fail('Tệp có cột trùng hoặc nhiều cột cùng ý nghĩa');
  const existing=new Set((await dbService.all('SELECT permit_number FROM permits')).map(p=>p.permit_number.toUpperCase()));
  const seen=new Set();
  const previewRows=rows.map((row,index)=>{
    let data=Object.fromEntries(fields.map((field,i)=>[field,row[i]??'']));
    const errors=[];
    try {
      if(row.length!==fields.length) fail('Số ô không khớp tiêu đề CSV');
      data.issue_date=normalizeDate(data.issue_date);
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
