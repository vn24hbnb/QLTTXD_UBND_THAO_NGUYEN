import test from 'node:test';
import assert from 'node:assert/strict';
import gisService from '../src/services/gis.js';

test('GIS: Xác thực tọa độ và phát hiện đảo kinh/vĩ độ (Lat/Lng swap)', () => {
  // Tọa độ hợp lệ tại Sơn La
  const valid = gisService.validateCoordinates(104.688, 20.893);
  assert.equal(valid.valid, true);

  // Tọa độ bị đảo (vĩ độ > 50, kinh độ < 50)
  const swapped = gisService.validateCoordinates(20.893, 104.688);
  assert.equal(swapped.valid, false);
  assert.equal(swapped.isSwapped, true);
  assert.equal(swapped.suggestedLng, 104.688);
  assert.equal(swapped.suggestedLat, 20.893);

  // Tọa độ ngoài dải WGS84
  const outOfRange = gisService.validateCoordinates(250, 95);
  assert.equal(outOfRange.valid, false);
});

test('GIS: Tính khoảng cách trắc địa chính xác (Haversine)', () => {
  const p1 = [104.688, 20.893];
  const p2 = [104.696, 20.828];

  const dist = gisService.calculateDistance(p1, p2);
  // Khoảng cách giữa 2 điểm này xấp xỉ 7.2 - 7.5 km
  assert.ok(dist > 7000 && dist < 8000, `Khoảng cách ${dist}m phải nằm trong khoảng 7-8 km`);
});

test('GIS: Tính diện tích đa giác trắc địa mặt cầu (m²)', () => {
  // Hình chữ nhật kích thước xấp xỉ 100m x 100m (~10.000 m²)
  const poly = [
    [104.6880, 20.8930],
    [104.6890, 20.8930],
    [104.6890, 20.8940],
    [104.6880, 20.8940]
  ];

  const area = gisService.calculatePolygonArea(poly);
  assert.ok(area > 9000 && area < 15000, `Diện tích ${area} m² phải xấp xỉ ~10.000 - 12.000 m²`);
});

test('GIS: Tải ranh giới địa giới 4 phường và tìm phường Thảo Nguyên (03982)', () => {
  const geo = gisService.getWardGeoJson();
  assert.equal(geo.type, 'FeatureCollection');
  assert.equal(geo.features.length, 4);

  const thaoNguyen = gisService.getThaoNguyenBoundary();
  assert.ok(thaoNguyen);
  assert.equal(thaoNguyen.properties.commune_code, '03982');
  assert.equal(thaoNguyen.properties.commune_name, 'Thảo Nguyên');
});
