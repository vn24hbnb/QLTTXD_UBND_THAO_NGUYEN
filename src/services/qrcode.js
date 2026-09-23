/**
 * Trình tạo mã QR thuần Node.js (Zero External Runtime Dependencies)
 * Tuân thủ chuẩn ISO/IEC 18004 (QR Code Model 2, Byte Mode)
 * Phục vụ Mốc C: Tra cứu công trình, quét mã tại biển báo công trình và biên bản kiểm tra
 */

// Bảng trường Galois GF(2^8) với đa thức nguyên thủy 0x11d (x^8 + x^4 + x^3 + x^2 + 1)
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
let val = 1;
for (let i = 0; i < 255; i++) {
  EXP[i] = val;
  EXP[i + 255] = val;
  LOG[val] = i;
  val = (val << 1) ^ (val >= 128 ? 0x11d : 0);
}

function gfMul(x, y) {
  return (x === 0 || y === 0) ? 0 : EXP[LOG[x] + LOG[y]];
}

// Sinh đa thức sinh lỗi Reed-Solomon cho bậc degree
function rsGeneratorPoly(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = [1, EXP[i]];
    const res = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j++) {
      res[j] ^= poly[j];
      res[j + 1] ^= gfMul(poly[j], next[1]);
    }
    poly = res;
  }
  return poly;
}

// Phép chia đa thức Reed-Solomon tính các từ mã sửa lỗi (Error Correction Codewords)
function rsCompute(data, ecCount) {
  const gen = rsGeneratorPoly(ecCount);
  const remainder = new Uint8Array(ecCount);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ remainder[0];
    for (let j = 0; j < ecCount - 1; j++) {
      remainder[j] = remainder[j + 1] ^ gfMul(gen[j + 1], factor);
    }
    remainder[ecCount - 1] = gfMul(gen[ecCount], factor);
  }
  return remainder;
}

// Bảng dung lượng và cấu trúc khối cho các phiên bản QR (Version 1 đến 8)
const QR_TABLE = [
  // Mức M (~15% sửa lỗi)
  { version: 1, level: 'M', ecBits: 0b00, dataCount: 16, ecPerBlock: 10, blocks: 1, align: [] },
  { version: 2, level: 'M', ecBits: 0b00, dataCount: 28, ecPerBlock: 16, blocks: 1, align: [6, 18] },
  { version: 3, level: 'M', ecBits: 0b00, dataCount: 44, ecPerBlock: 26, blocks: 1, align: [6, 22] },
  { version: 4, level: 'M', ecBits: 0b00, dataCount: 64, ecPerBlock: 18, blocks: 2, align: [6, 26] },
  { version: 5, level: 'M', ecBits: 0b00, dataCount: 86, ecPerBlock: 24, blocks: 2, align: [6, 30] },
  { version: 6, level: 'M', ecBits: 0b00, dataCount: 108, ecPerBlock: 16, blocks: 4, align: [6, 34] },
  { version: 7, level: 'M', ecBits: 0b00, dataCount: 124, ecPerBlock: 18, blocks: 4, align: [6, 22, 38] },
  { version: 8, level: 'M', ecBits: 0b00, dataCount: 154, ecPerBlock: 22, blocks: 4, align: [6, 24, 42] },

  // Mức L (~7% sửa lỗi - dung lượng lớn)
  { version: 1, level: 'L', ecBits: 0b01, dataCount: 19, ecPerBlock: 7, blocks: 1, align: [] },
  { version: 2, level: 'L', ecBits: 0b01, dataCount: 34, ecPerBlock: 10, blocks: 1, align: [6, 18] },
  { version: 3, level: 'L', ecBits: 0b01, dataCount: 55, ecPerBlock: 15, blocks: 1, align: [6, 22] },
  { version: 4, level: 'L', ecBits: 0b01, dataCount: 80, ecPerBlock: 20, blocks: 1, align: [6, 26] },
  { version: 5, level: 'L', ecBits: 0b01, dataCount: 108, ecPerBlock: 26, blocks: 1, align: [6, 30] },
  { version: 6, level: 'L', ecBits: 0b01, dataCount: 136, ecPerBlock: 18, blocks: 2, align: [6, 34] },
  { version: 7, level: 'L', ecBits: 0b01, dataCount: 156, ecPerBlock: 20, blocks: 2, align: [6, 22, 38] },
  { version: 8, level: 'L', ecBits: 0b01, dataCount: 194, ecPerBlock: 24, blocks: 2, align: [6, 24, 42] }
];

// Tính chuỗi 15 bit định dạng theo mã BCH(15, 5)
function getFormatBits(ecBits, mask) {
  const data = (ecBits << 3) | mask;
  let d = data << 10;
  for (let i = 4; i >= 0; i--) {
    if ((d >> (i + 10)) & 1) {
      d ^= (0x537 << i);
    }
  }
  return ((data << 10) | d) ^ 0x5412;
}

// 8 hàm mặt nạ chuẩn QR
const MASK_PATTERNS = [
  (r, c) => (r + c) % 2 === 0,
  (r, c) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0
];

// Đóng gói luồng bit Byte Mode
function encodeData(text, versionInfo) {
  const bytes = Buffer.from(text, 'utf-8');
  const totalDataCount = versionInfo.dataCount;

  const bits = [];
  const appendBits = (val, length) => {
    for (let i = length - 1; i >= 0; i--) {
      bits.push((val >> i) & 1);
    }
  };

  // 1. Chỉ báo chế độ Byte (0100)
  appendBits(0b0100, 4);

  // 2. Độ dài chuỗi (8 bit cho Version 1-9)
  appendBits(bytes.length, 8);

  // 3. Các byte dữ liệu UTF-8
  for (let i = 0; i < bytes.length; i++) {
    appendBits(bytes[i], 8);
  }

  // 4. Ký tự kết thúc (Terminator)
  const maxBits = totalDataCount * 8;
  const termLen = Math.min(4, maxBits - bits.length);
  appendBits(0, termLen);

  // 5. Độn về biên byte (bội số của 8)
  while (bits.length % 8 !== 0) {
    bits.push(0);
  }

  // 6. Chuyển thành mảng từ mã (Codewords)
  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byteVal = 0;
    for (let b = 0; b < 8; b++) {
      byteVal = (byteVal << 1) | bits[i + b];
    }
    codewords.push(byteVal);
  }

  // 7. Độn các byte 0xEC và 0x11 cho đủ dung lượng khối dữ liệu
  const padBytes = [0xec, 0x11];
  let padIdx = 0;
  while (codewords.length < totalDataCount) {
    codewords.push(padBytes[padIdx % 2]);
    padIdx++;
  }

  // 8. Chia thành các khối và tính từ mã sửa lỗi (Reed-Solomon)
  const numBlocks = versionInfo.blocks;
  const baseDataPerBlock = Math.floor(totalDataCount / numBlocks);
  const dataBlocks = [];
  const ecBlocks = [];

  let offset = 0;
  for (let b = 0; b < numBlocks; b++) {
    const bData = codewords.slice(offset, offset + baseDataPerBlock);
    offset += baseDataPerBlock;
    dataBlocks.push(bData);
    ecBlocks.push(Array.from(rsCompute(new Uint8Array(bData), versionInfo.ecPerBlock)));
  }

  // 9. Xếp xen kẽ dữ liệu và mã sửa lỗi (Interleaving)
  const finalCodewords = [];
  for (let i = 0; i < baseDataPerBlock; i++) {
    for (let b = 0; b < numBlocks; b++) {
      finalCodewords.push(dataBlocks[b][i]);
    }
  }

  for (let i = 0; i < versionInfo.ecPerBlock; i++) {
    for (let b = 0; b < numBlocks; b++) {
      finalCodewords.push(ecBlocks[b][i]);
    }
  }

  return finalCodewords;
}

// Đánh giá điểm phạt ma trận (Penalty score) theo ISO/IEC 18004
function calculatePenalty(matrix, N) {
  let penalty = 0;

  // N1: 5 hoặc nhiều module cùng màu liên tiếp
  for (let r = 0; r < N; r++) {
    let runColor = -1, runLen = 0;
    for (let c = 0; c < N; c++) {
      const color = matrix[r][c];
      if (color === runColor) {
        runLen++;
      } else {
        if (runLen >= 5) penalty += 3 + (runLen - 5);
        runColor = color;
        runLen = 1;
      }
    }
    if (runLen >= 5) penalty += 3 + (runLen - 5);
  }

  for (let c = 0; c < N; c++) {
    let runColor = -1, runLen = 0;
    for (let r = 0; r < N; r++) {
      const color = matrix[r][c];
      if (color === runColor) {
        runLen++;
      } else {
        if (runLen >= 5) penalty += 3 + (runLen - 5);
        runColor = color;
        runLen = 1;
      }
    }
    if (runLen >= 5) penalty += 3 + (runLen - 5);
  }

  // N2: Khối 2x2 cùng màu
  for (let r = 0; r < N - 1; r++) {
    for (let c = 0; c < N - 1; c++) {
      const val = matrix[r][c];
      if (val === matrix[r][c + 1] && val === matrix[r + 1][c] && val === matrix[r + 1][c + 1]) {
        penalty += 3;
      }
    }
  }

  return penalty;
}

/**
 * Tạo ma trận QR Code hoàn chỉnh
 */
export function createQrMatrix(text, { preferredLevel = 'M' } = {}) {
  const bytes = Buffer.from(text, 'utf-8');
  let info = QR_TABLE.find(t => t.level === preferredLevel && t.dataCount - 3 >= bytes.length);
  if (!info) {
    info = QR_TABLE.find(t => t.level === 'L' && t.dataCount - 3 >= bytes.length);
  }
  if (!info) {
    throw new Error(`Nội dung quá dài để mã hóa trong QR Code (${bytes.length} bytes)`);
  }

  const N = 4 * info.version + 17;
  const baseMatrix = Array.from({ length: N }, () => new Int8Array(N).fill(-1));
  const isFunction = Array.from({ length: N }, () => new Uint8Array(N).fill(0));

  function setFinder(row, col) {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const isDark = (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
        baseMatrix[row + r][col + c] = isDark ? 1 : 0;
        isFunction[row + r][col + c] = 1;
      }
    }
    // Dải phân cách (Separator)
    for (let r = -1; r <= 7; r++) {
      for (let c = -1; c <= 7; c++) {
        if (r === -1 || r === 7 || c === -1 || c === 7) {
          const rr = row + r;
          const cc = col + c;
          if (rr >= 0 && rr < N && cc >= 0 && cc < N) {
            baseMatrix[rr][cc] = 0;
            isFunction[rr][cc] = 1;
          }
        }
      }
    }
  }

  // 1. Ba mẫu định vị (Finder patterns)
  setFinder(0, 0);
  setFinder(0, N - 7);
  setFinder(N - 7, 0);

  // 2. Mẫu căn chỉnh (Alignment patterns)
  if (info.align && info.align.length > 0) {
    for (const r of info.align) {
      for (const c of info.align) {
        if ((r < 9 && c < 9) || (r < 9 && c >= N - 8) || (r >= N - 8 && c < 9)) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const isDark = (Math.max(Math.abs(dr), Math.abs(dc)) === 2 || (dr === 0 && dc === 0));
            baseMatrix[r + dr][c + dc] = isDark ? 1 : 0;
            isFunction[r + dr][c + dc] = 1;
          }
        }
      }
    }
  }

  // 3. Đường đồng bộ (Timing patterns)
  for (let i = 8; i < N - 8; i++) {
    if (!isFunction[6][i]) {
      baseMatrix[6][i] = (i % 2 === 0) ? 1 : 0;
      isFunction[6][i] = 1;
    }
    if (!isFunction[i][6]) {
      baseMatrix[i][6] = (i % 2 === 0) ? 1 : 0;
      isFunction[i][6] = 1;
    }
  }

  // 4. Điểm tối cố định (Dark module)
  baseMatrix[4 * info.version + 9][8] = 1;
  isFunction[4 * info.version + 9][8] = 1;

  // 5. Dự lưu vùng thông tin định dạng (Format Information Modules)
  const formatModules1 = [
    [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8],
    [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]
  ];
  const formatModules2 = [
    [8, N - 1], [8, N - 2], [8, N - 3], [8, N - 4], [8, N - 5], [8, N - 6], [8, N - 7], [8, N - 8],
    [N - 7, 8], [N - 6, 8], [N - 5, 8], [N - 4, 8], [N - 3, 8], [N - 2, 8], [N - 1, 8]
  ];

  for (const [r, c] of formatModules1) isFunction[r][c] = 1;
  for (const [r, c] of formatModules2) isFunction[r][c] = 1;

  // 6. Mã hóa dữ liệu và sinh luồng bit
  const codewords = encodeData(text, info);
  const dataBits = [];
  for (const cw of codewords) {
    for (let i = 7; i >= 0; i--) {
      dataBits.push((cw >> i) & 1);
    }
  }

  // 7. Thử nghiệm các mặt nạ để chọn mặt nạ có điểm phạt thấp nhất
  let bestMask = 0;
  let lowestPenalty = Infinity;
  let bestMatrix = null;

  for (let maskIdx = 0; maskIdx < 8; maskIdx++) {
    const matrix = baseMatrix.map(row => new Int8Array(row));
    const maskFn = MASK_PATTERNS[maskIdx];

    // Điền dữ liệu theo ziczac từ phải sang trái
    let bitIdx = 0;
    let upwards = true;
    for (let rightCol = N - 1; rightCol > 0; rightCol -= 2) {
      if (rightCol === 6) rightCol--; // Bỏ qua đường timing dọc
      const rows = upwards
        ? Array.from({ length: N }, (_, i) => N - 1 - i)
        : Array.from({ length: N }, (_, i) => i);

      for (const r of rows) {
        for (const c of [rightCol, rightCol - 1]) {
          if (!isFunction[r][c]) {
            const bit = bitIdx < dataBits.length ? dataBits[bitIdx++] : 0;
            matrix[r][c] = maskFn(r, c) ? (bit ^ 1) : bit;
          }
        }
      }
      upwards = !upwards;
    }

    // Điền chuỗi thông tin định dạng 15 bit
    const formatVal = getFormatBits(info.ecBits, maskIdx);
    for (let i = 0; i < 15; i++) {
      const bit = (formatVal >> (14 - i)) & 1; // Bit 0 (MSB) tới Bit 14 (LSB)
      const [r1, c1] = formatModules1[i];
      const [r2, c2] = formatModules2[i];
      matrix[r1][c1] = bit;
      matrix[r2][c2] = bit;
    }

    const penalty = calculatePenalty(matrix, N);
    if (penalty < lowestPenalty) {
      lowestPenalty = penalty;
      bestMask = maskIdx;
      bestMatrix = matrix;
    }
  }

  return {
    matrix: bestMatrix,
    size: N,
    version: info.version,
    level: info.level,
    mask: bestMask
  };
}

/**
 * Xuất chuỗi SVG véc-tơ chuẩn cho mã QR
 */
export function generateQrSvg(text, { size = 200, padding = 4, fgColor = '#1a1c1f', bgColor = '#ffffff' } = {}) {
  const { matrix, size: N, version, level } = createQrMatrix(text);
  const total = N + padding * 2;

  let path = '';
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      if (matrix[r][c] === 1) {
        const x = c + padding;
        const y = r + padding;
        path += `M${x},${y}h1v1h-1z `;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${size}" height="${size}" shape-rendering="crispEdges" aria-label="Mã QR tra cứu ${level} V${version}">
  <rect width="${total}" height="${total}" fill="${bgColor}"/>
  <path d="${path.trim()}" fill="${fgColor}"/>
</svg>`;
}

/**
 * Xuất Data URI dạng SVG để nhúng trực tiếp thẻ <img>
 */
export function generateQrDataUri(text, options = {}) {
  const svg = generateQrSvg(text, options);
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function getPermitQrUrl(permitNumber, baseUrl = 'http://localhost:3000') {
  return `${baseUrl}/?permit=${encodeURIComponent(permitNumber)}`;
}

export function getComplaintQrUrl(lookupCode, baseUrl = 'http://localhost:3000') {
  return `${baseUrl}/?tra-cuu=${encodeURIComponent(lookupCode)}`;
}

export default {
  createQrMatrix,
  generateQrSvg,
  generateQrDataUri,
  getPermitQrUrl,
  getComplaintQrUrl
};
