import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const GEO_PATH = path.resolve(__dirname, '../../data/thao_nguyen_geo.json');

const EARTH_RADIUS_METERS = 6371008.8; // Bán kính chuẩn WGS84

let cachedGeoJson = null;

export function getWardGeoJson() {
  if (cachedGeoJson) return cachedGeoJson;
  if (!fs.existsSync(GEO_PATH)) {
    throw new Error('Tệp địa giới thao_nguyen_geo.json chưa được tạo');
  }
  const raw = fs.readFileSync(GEO_PATH, 'utf8');
  cachedGeoJson = JSON.parse(raw);
  return cachedGeoJson;
}

export function getThaoNguyenBoundary() {
  const geo = getWardGeoJson();
  return geo.features.find(f => f.properties?.commune_code === '03982');
}

/**
 * Tính khoảng cách trắc địa giữa 2 điểm WGS84 (mét) bằng công thức Haversine
 * @param {[number, number]} coord1 [lng1, lat1]
 * @param {[number, number]} coord2 [lng2, lat2]
 * @returns {number} Khoảng cách tính bằng mét
 */
export function calculateDistance(coord1, coord2) {
  const [lng1, lat1] = coord1;
  const [lng2, lat2] = coord2;

  const toRad = deg => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

/**
 * Tính diện tích đa giác mặt cầu WGS84 (m²)
 * @param {Array<[number, number]>} coords Mảng các điểm [lng, lat]
 * @returns {number} Diện tích tính bằng m²
 */
export function calculatePolygonArea(coords) {
  if (!coords || coords.length < 3) return 0;

  const toRad = deg => (deg * Math.PI) / 180;
  let total = 0;

  // Thuật toán Girard / Gauss-Bonnet trên mặt cầu
  for (let i = 0; i < coords.length; i++) {
    const p1 = coords[i];
    const p2 = coords[(i + 1) % coords.length];
    total += (toRad(p2[0]) - toRad(p1[0])) * (2 + Math.sin(toRad(p1[1])) + Math.sin(toRad(p2[1])));
  }

  const area = Math.abs((total * EARTH_RADIUS_METERS * EARTH_RADIUS_METERS) / 2);
  // Giới hạn bán cầu
  const hemisphere = 2 * Math.PI * EARTH_RADIUS_METERS * EARTH_RADIUS_METERS;
  return area > hemisphere ? 2 * hemisphere - area : area;
}

/**
 * Kiểm tra điểm [lng, lat] có nằm trong đa giác hay không (Ray-casting)
 */
export function isPointInPolygon(point, polygon) {
  const [x, y] = point;
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0],
      yi = polygon[i][1];
    const xj = polygon[j][0],
      yj = polygon[j][1];

    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }

  return inside;
}

/**
 * Kiểm tra tọa độ có thuộc địa bàn phường Thảo Nguyên (03982) không
 */
export function isPointInThaoNguyen(point) {
  const boundary = getThaoNguyenBoundary();
  if (!boundary || !boundary.geometry) return true; // dự phòng nếu chưa có ranh

  const geom = boundary.geometry;
  if (geom.type === 'Polygon') {
    return isPointInPolygon(point, geom.coordinates[0]);
  } else if (geom.type === 'MultiPolygon') {
    return geom.coordinates.some(poly => isPointInPolygon(point, poly[0]));
  }
  return true;
}

/**
 * Kiểm tra tính hợp lệ của tọa độ và phát hiện trường hợp đảo kinh/vĩ độ
 */
export function validateCoordinates(lng, lat) {
  if (typeof lng !== 'number' || typeof lat !== 'number' || isNaN(lng) || isNaN(lat)) {
    return { valid: false, error: 'Tọa độ không hợp lệ (phải là số)' };
  }

  // Phát hiện lỗi đảo Lat/Lng: tại Việt Nam, Lat thường ~ 8 - 23, Lng thường ~ 102 - 110
  if (lat > 50 && lng < 50) {
    return {
      valid: false,
      isSwapped: true,
      suggestedLng: lat,
      suggestedLat: lng,
      error: 'Tọa độ bị đảo ngược giữa Kinh độ (Lng) và Vĩ độ (Lat)'
    };
  }

  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return { valid: false, error: 'Tọa độ nằm ngoài phạm vi WGS84' };
  }

  return { valid: true };
}

/**
 * Lọc các thực thể nằm trong khung nhìn Bounding Box [minLng, minLat, maxLng, maxLat]
 */
export function filterByBoundingBox(items, [minLng, minLat, maxLng, maxLat]) {
  return items.filter(
    item =>
      item.longitude >= minLng &&
      item.longitude <= maxLng &&
      item.latitude >= minLat &&
      item.latitude <= maxLat
  );
}

export default {
  getWardGeoJson,
  getThaoNguyenBoundary,
  calculateDistance,
  calculatePolygonArea,
  isPointInPolygon,
  isPointInThaoNguyen,
  validateCoordinates,
  filterByBoundingBox
};
