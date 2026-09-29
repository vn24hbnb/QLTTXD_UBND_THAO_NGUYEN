/**
 * Hệ thống Quản lý Trật tự Xây dựng Phường Thảo Nguyên, Tỉnh Sơn La
 * Giao diện Chuẩn Google Maps & Material Design 3 (M3)
 * Bản đồ Vệ tinh Toàn màn hình (Google Satellite Hybrid)
 */

(function () {
  'use strict';

  // --- TRẠNG THÁI ỨNG DỤNG TOÀN CỤC ---
  const state = {
    role: 'citizen',
    user: null,
    authEpoch: 0,
    activeInspection: null,
    permits: [],
    complaints: [],
    violations: [],
    auditLogs: [],
    selectedPermit: null,
    filter: 'all',
    searchQuery: '',
    currentLayer: 'satellite',
    showBoundary: true,
    showMarkers: true,
    showComplaintPins: true,
    complaintPins: [],
    myComplaintPins: [],
    showComplaints: true,
    geoData: null,
    offlineDrafts: [],
    measureMode: null, // null, 'dist', 'area'
    measurePoints: [],
    measureMarkers: [],
    measureLayer: null,
    coordinatePicker: null,
    savedMeasurements: []
  };

  // Cấu hình bản đồ trung tâm Phường Thảo Nguyên
  const MAP_CENTER = [20.8915, 104.6855];
  const MAP_ZOOM = 15;

  let map = null;
  let tileLayers = {};
  let boundaryLayerGroup = null;
  let markersLayerGroup = null;
  let complaintsLayerGroup = null;

  // 4 Mốc kiểm tra trật tự xây dựng chuẩn
  const STAGES = [
    'Mốc 1: Trước khi đào móng',
    'Mốc 2: Xong phần móng tầng 1',
    'Mốc 3: Đổ mái tầng 1',
    'Mốc 4: Hoàn thành công trình'
  ];

  // --- HÀM TRỢ GIÚP TIỆN ÍCH ---
  function q(sel) { return document.querySelector(sel); }
  function qa(sel) { return document.querySelectorAll(sel); }
  function esc(str) {
    if (str === null || str === undefined) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function showToast(msg, duration = 3000) {
    const toast = q('#google-toast');
    if (!toast) return;
    toast.textContent = msg;
    toast.classList.add('active');
    setTimeout(() => toast.classList.remove('active'), duration);
  }

  const ROLE_NAMES = { citizen: 'Người dân', inspector: 'Cán bộ kiểm tra', receptionist: 'Cán bộ tiếp nhận', coordinator: 'Người điều phối', admin: 'Quản trị' };
  const isStaff = () => !!state.user;
  const canInspect = () => isStaff() && ['inspector', 'coordinator', 'admin'].includes(state.role);
  const canApprove = () => isStaff() && ['coordinator', 'admin'].includes(state.role);
  const canReceive = () => isStaff() && ['receptionist', 'coordinator', 'admin'].includes(state.role);
  const uniqueKey = prefix => `${prefix}-${crypto.randomUUID()}`;
  const displayValue = (value, unit = '') => value === null || value === undefined || value === '' ? 'Chưa có dữ liệu' : `${esc(value)}${unit ? ' ' + esc(unit) : ''}`;
  const MY_COMPLAINT_CODES_KEY = 'qlttxd_my_complaints';
  const MAX_SAVED_COMPLAINT_CODES = 15;
  function savedComplaintCodes() {
    try {
      const parsed = JSON.parse(localStorage.getItem(MY_COMPLAINT_CODES_KEY) || '[]');
      return Array.isArray(parsed) ? [...new Set(parsed.filter(code => typeof code === 'string' && /^TN-DEMO-[A-F0-9]{32}$/i.test(code)))].slice(0, MAX_SAVED_COMPLAINT_CODES) : [];
    } catch { return []; }
  }
  function rememberComplaintCode(code) {
    if (typeof code !== 'string' || !/^TN-DEMO-[A-F0-9]{32}$/i.test(code)) return false;
    try {
      localStorage.setItem(MY_COMPLAINT_CODES_KEY, JSON.stringify([code.toUpperCase(), ...savedComplaintCodes().filter(saved => saved !== code.toUpperCase())].slice(0, MAX_SAVED_COMPLAINT_CODES)));
      return true;
    } catch { return false; }
  }
  function forgetComplaintCode(code) {
    try { localStorage.setItem(MY_COMPLAINT_CODES_KEY, JSON.stringify(savedComplaintCodes().filter(saved => saved !== code))); } catch {}
  }

  async function api(url, options = {}) {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'no-store', ...options });
    let json;
    try { json = await response.json(); }
    catch { throw new Error('Máy chủ trả về dữ liệu không hợp lệ. Chưa xác nhận đã lưu.'); }
    if (!response.ok || json?.success !== true) {
      if (response.status === 401 && url.startsWith('/api/internal/') && !url.endsWith('/login')) setUser(null);
      const message = typeof json?.error === 'string' ? json.error : json?.error?.message;
      const error = new Error(message || 'Không thể thực hiện yêu cầu. Vui lòng thử lại.');
      error.status = response.status;
      error.requireTotp = json?.requireTotp;
      throw error;
    }
    return json;
  }

  function postJson(url, body, key) {
    return api(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) },
      body: JSON.stringify(body)
    });
  }

  function setUser(user) {
    state.authEpoch += 1;
    state.user = user ? { id: user.id || user.user_id, username: user.username, full_name: user.full_name, role: user.role } : null;
    state.role = state.user?.role || 'citizen';
    state.permits = [];
    state.complaints = [];
    state.selectedPermit = null;
    state.activeInspection = null;
    state.coordinatePicker = null;
    q('#google-map')?.classList.remove('picking-permit-coordinates');
    state.offlineDrafts = [];
    q('#google-place-card').style.display = 'none';
    q('#place-tech-specs').innerHTML = '';
    q('#place-history-list').innerHTML = '';
    q('#surface-body').innerHTML = '';
    closeSurfaceModal();
    loadOfflineDrafts();
    updateAccountUi();
    updateFilterCounts();
    renderMarkers();
  }

  function updateAccountUi() {
    q('#google-avatar').textContent = isStaff() ? 'CB' : 'ND';
    q('#popup-avatar').textContent = isStaff() ? 'CB' : 'ND';
    q('#popup-username').textContent = state.user?.full_name || state.user?.username || 'Người dân (Công khai)';
    q('#popup-role-badge').textContent = ROLE_NAMES[state.role] || 'Cán bộ';
    q('#popup-role-badge').className = 'google-badge ' + (isStaff() ? 'badge-admin' : 'badge-primary');
    q('#fab-label').textContent = canInspect() ? 'Công việc' : 'Phản ánh';
    q('#btn-login').hidden = isStaff();
    q('#btn-logout').hidden = !isStaff();
    qa('[data-access]').forEach(el => {
      const access = el.dataset.access;
      el.hidden = !(access === 'guest' ? !isStaff() : access === 'staff' ? isStaff() : access === 'inspect' ? canInspect() : access === 'approve' ? canApprove() : access === 'admin' ? state.role === 'admin' : false);
    });
    const parcelPermitButton = q('#btn-permit-from-parcel');
    if (parcelPermitButton) parcelPermitButton.hidden = !(canApprove() && state.measureMode === 'area' && state.measurePoints.length >= 3);
  }

  async function restoreSession() {
    try { const result = await api('/api/internal/auth/me'); setUser(result.user); }
    catch { setUser(null); }
  }

  function showLoginForm() {
    openSurfaceModal('Đăng nhập cán bộ', `<form id="form-login" class="app-form">
      <label for="login-username">Tên đăng nhập</label><input id="login-username" autocomplete="username" required>
      <label for="login-password">Mật khẩu</label><input type="password" id="login-password" autocomplete="current-password" required>
      <label id="login-totp-label" for="login-totp" hidden>Mã xác thực 6 số</label><input id="login-totp" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" hidden>
      <p id="login-error" class="form-error" role="alert"></p><button type="submit" class="google-btn btn-primary">Đăng nhập</button>
    </form>`);
    q('#form-login').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      if (form.dataset.busy) return;
      form.dataset.busy = '1';
      try {
        const result = await postJson('/api/internal/auth/login', { username: q('#login-username').value.trim(), password: q('#login-password').value, totp_token: q('#login-totp').value.trim() || undefined });
        if (!result.user?.role || !(result.user.id || result.user.user_id)) throw new Error('Máy chủ chưa xác nhận tài khoản.');
        setUser(result.user);
        await fetchData();
        showToast('Đã đăng nhập cán bộ.');
      } catch (error) {
        q('#login-error').textContent = error.message;
        if (error.requireTotp) {
          q('#login-totp-label').hidden = false;
          q('#login-totp').hidden = false;
          q('#login-totp').focus();
        }
      } finally { delete form.dataset.busy; }
    });
  }

  async function logout() {
    try {
      await postJson('/api/internal/auth/logout', {});
      setUser(null);
      await fetchData();
      showToast('Đã đăng xuất.');
    } catch (error) {
      setUser(null);
      showToast('Đã ẩn dữ liệu trên màn hình. Chưa thu hồi được phiên máy chủ; hãy thử đăng xuất lại khi có mạng.', 8000);
      q('#btn-logout').hidden = false;
    }
  }

  function draftStorageKey() {
    if (!state.user?.id) throw new Error('Vui lòng đăng nhập để lưu bản nháp của bạn.');
    return `qlttxd_offline_inspections:${state.user.id}`;
  }

  function loadOfflineDrafts() {
    state.offlineDrafts = [];
    if (!state.user?.id) return;
    try {
      const data = JSON.parse(localStorage.getItem(draftStorageKey()) || '[]');
      if (Array.isArray(data)) state.offlineDrafts = data.filter(d => d.user_id === state.user.id && typeof d.idempotency_key === 'string');
    } catch { showToast('Không đọc được bản nháp trên thiết bị.'); }
  }

  function saveOfflineDraft(draft) {
    if (draft.user_id !== state.user?.id) throw new Error('Bản nháp không thuộc tài khoản đang đăng nhập.');
    const next = [...state.offlineDrafts.filter(d => d.idempotency_key !== draft.idempotency_key), draft];
    try { localStorage.setItem(draftStorageKey(), JSON.stringify(next)); }
    catch { throw new Error('Thiết bị không còn chỗ lưu nháp. Nội dung vẫn ở biểu mẫu; hãy giữ cửa sổ này.'); }
    state.offlineDrafts = next;
  }

  function clearOfflineDraft(idempKey) {
    const next = state.offlineDrafts.filter(d => d.idempotency_key !== idempKey);
    localStorage.setItem(draftStorageKey(), JSON.stringify(next));
    state.offlineDrafts = next;
  }

  function normalizePermit(item) {
    const done = Number(item.current_stage) || 0;
    return { ...item, place: item.site_address || '', done, checked: STAGES.map((_, i) => i < done), coord: [item.longitude, item.latitude] };
  }

  let thaoNguyenLayer = null;

  // --- KHỞI TẠO BẢN ĐỒ VỆ TINH LEAFLET (ZOOM TỶ LỆ THUẬN & KỸ THUẬT SỐ 22X) ---
  function initMap() {
    if (typeof L === 'undefined') {
      console.warn('Đang chờ thư viện Leaflet nạp...');
      setTimeout(initMap, 150);
      return;
    }

    if (map) return;

    // Leaflet animate ảnh tile hiện tại trong lúc zoom, rồi mới yêu cầu lưới tile ở mức mới.
    map = L.map('google-map', {
      center: MAP_CENTER,
      zoom: MAP_ZOOM,
      zoomSnap: 0.5,
      zoomDelta: 0.5,
      wheelPxPerZoomLevel: 100,
      wheelDebounceTime: 40,
      zoomAnimation: true,
      scrollWheelZoom: true,
      doubleClickZoom: false,
      zoomControl: false,      // Dùng bộ điều khiển nổi chuẩn Google
      attributionControl: true,
      maxZoom: 20,
      minZoom: 11
    });

    // 1. LỚP VỆ TINH GOOGLE HYBRID
    tileLayers.satellite = L.tileLayer('https://mt{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
      subdomains: ['0', '1', '2', '3'],
      maxNativeZoom: 18,
      maxZoom: 20,
      keepBuffer: 3,
      updateWhenZooming: false,
      attribution: '© Google Satellite Hybrid | Phường Thảo Nguyên'
    });

    // 2. LỚP BẢN ĐỒ GIAO THÔNG GOOGLE (Roadmap)
    tileLayers.roadmap = L.tileLayer('https://mt{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
      subdomains: ['0', '1', '2', '3'],
      maxNativeZoom: 19,
      maxZoom: 20,
      keepBuffer: 3,
      updateWhenZooming: false,
      attribution: '© Google Maps Roadmap'
    });

    // 3. LỚP ẢNH VỆ TINH ESRI (Lớp nền dự phòng)
    tileLayers.esri = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxNativeZoom: 18,
      maxZoom: 20,
      keepBuffer: 3,
      updateWhenZooming: false,
      attribution: 'Tiles © Esri World Imagery'
    });

    // Mặc định kích hoạt Google Satellite Hybrid
    tileLayers.satellite.addTo(map);

    // Tạo các nhóm lớp đồ họa
    boundaryLayerGroup = L.layerGroup().addTo(map);
    markersLayerGroup = L.layerGroup().addTo(map);
    complaintsLayerGroup = L.layerGroup().addTo(map);
    renderComplaintPins();
    state.measureLayer = L.layerGroup().addTo(map);

    // Chọn điểm phản ánh bằng nhấp đúp; click đơn chỉ dùng để đo khi bật thước.
    map.on('click', handleMapClick);
    map.on('dblclick', handleMapDoubleClick);

    // Nạp dữ liệu ranh giới và công trình
    loadGeoBoundary();
  }

  // --- NẠP RANH GIỚI ĐỊA GIỚI 4 XÃ/PHƯỜNG ---
  async function loadGeoBoundary() {
    try {
      const res = await fetch('/api/public/geojson/boundary');
      if (!res.ok) return;
      const json = await res.json();
      // BẮT BUỘC TRÍCH XUẤT .data TỪ ĐÁP ỨNG { success: true, data: FeatureCollection }
      state.geoData = (json && json.data) ? json.data : json;
      renderBoundary(true); // Lần đầu nạp tự động căn vừa khung nhìn (fitBounds)
    } catch (err) {
      console.error('Không thể tải ranh giới địa giới:', err);
    }
  }

  // Hàm căn chỉnh toàn cảnh ranh giới Phường Thảo Nguyên
  function fitThaoNguyenBoundary() {
    if (thaoNguyenLayer && map) {
      map.fitBounds(thaoNguyenLayer.getBounds(), { padding: [50, 50], maxZoom: 16 });
      showToast('📍 Đã căn giữa toàn cảnh Ranh giới Phường Thảo Nguyên (03982)');
    }
  }

  // --- VẼ ĐƯỜNG PHÂN ĐỊNH RANH GIỚI GIỮA CÁC XÃ, PHƯỜNG (ĐƯỜNG KẺ ĐỨT MÀU VÀNG DỊU, NỀN TRONG SUỐT 100%) ---
  function renderBoundary(autoFit = false) {
    if (!boundaryLayerGroup || !state.geoData) return;
    boundaryLayerGroup.clearLayers();
    thaoNguyenLayer = null;

    if (!state.showBoundary) return;

    // Đường kẻ đứt màu vàng thanh mảnh, dịu mắt, nền trong suốt tuyệt đối
    // interactive: false đảm bảo click xuyên qua hoàn toàn và triệt tiêu vĩnh viễn ô vuông focus của trình duyệt
    L.geoJSON(state.geoData, {
      interactive: false,
      style: function (feature) {
        const isThaoNguyen = feature.properties && feature.properties.commune_code === '03982';
        return {
          color: isThaoNguyen ? '#facc15' : '#eab308', // Màu vàng dịu nhẹ tự nhiên, không bị quá đậm hay chói
          weight: isThaoNguyen ? 2.5 : 1.8,            // Nét mảnh thanh lịch, vừa đủ nhìn rõ ranh giới
          opacity: 0.85,
          dashArray: '6, 6',                           // Đường kẻ đứt màu vàng tinh tế
          fill: false,                                 // NỀN TRONG SUỐT 100% (chỉ giữ lại ranh giới các xã/phường)
          fillOpacity: 0,
          interactive: false
        };
      },
      onEachFeature: function (feature, layer) {
        const isThaoNguyen = feature.properties && feature.properties.commune_code === '03982';
        if (isThaoNguyen) {
          thaoNguyenLayer = layer;
        }
      }
    }).addTo(boundaryLayerGroup);

    // Tự động căn chỉnh toàn cảnh Phường Thảo Nguyên khi vừa nạp xong
    if (autoFit && thaoNguyenLayer && map) {
      map.fitBounds(thaoNguyenLayer.getBounds(), { padding: [50, 50], maxZoom: 16 });
    }
  }

  // --- NẠP DỮ LIỆU CÔNG TRÌNH VÀ PHẢN ÁNH TỪ MÁY CHỦ ---
  async function fetchData() {
    const epoch = state.authEpoch;
    try {
      const result = await api(isStaff() ? '/api/internal/permits' : '/api/public/permits');
      if (epoch !== state.authEpoch) return;
      state.permits = (result.data || []).map(normalizePermit);
      q('#count-all').textContent = state.permits.length;
      updateFilterCounts();
      renderMarkers();
    } catch (error) { showToast(error.message, 6000); }
    await fetchComplaintPins(epoch);
  }

  // Lớp phản ánh trên bản đồ:
  //  - Người dân: ghim công khai (đã xác minh) + ghim kiến nghị của chính mình (tra bằng mã bí mật đã lưu).
  //  - Cán bộ: toàn bộ phản ánh đang xử lý, để thấy ngay kiến nghị mới gửi.
  async function fetchComplaintPins(epoch = state.authEpoch) {
    if (isStaff()) {
      try {
        const result = await api('/api/internal/complaints');
        if (epoch !== state.authEpoch) return;
        state.complaints = result.data || [];
        state.complaintPins = [];
        state.myComplaintPins = [];
        updateFilterCounts();
      } catch { /* danh sách đầy đủ vẫn mở được từ mục Phản ánh */ }
    } else {
      try {
        const result = await api('/api/public/complaints/map');
        if (epoch !== state.authEpoch) return;
        state.complaintPins = Array.isArray(result.data) ? result.data : [];
      } catch { state.complaintPins = []; }
      state.complaints = [];
      const settled = await Promise.allSettled(savedComplaintCodes().slice(0, 10).map(code => api(`/api/public/complaints/lookup?code=${encodeURIComponent(code)}`)));
      if (epoch !== state.authEpoch) return;
      state.myComplaintPins = settled.filter(r => r.status === 'fulfilled' && r.value?.data).map(r => ({ ...r.value.data, mine: true }));
    }
    renderComplaintPins();
  }

  function complaintPinColor(step, mine) {
    if (mine) return '#e8710a';
    if (step <= 1) return '#ea4335';
    if (step <= 3) return '#fbbc04';
    return step >= 5 ? '#34a853' : '#8e24aa';
  }

  function renderComplaintPins() {
    if (!complaintsLayerGroup) return;
    complaintsLayerGroup.clearLayers();
    if (!state.showComplaintPins) return;
    const mine = state.myComplaintPins.map(c => ({ lat: c.latitude, lng: c.longitude, address: c.location_text, status: c.status_label, mine: true, step: Number(c.status_step) }));
    const seen = new Set(mine.map(c => `${Number(c.lat).toFixed(5)},${Number(c.lng).toFixed(5)}`));
    const others = isStaff()
      ? state.complaints.filter(c => !c.master_complaint_id).map(c => ({ lat: c.latitude, lng: c.longitude, address: c.location_text, status: c.status_label, title: c.title, step: Number(c.status_step) }))
      : state.complaintPins.map(c => ({ lat: c.latitude, lng: c.longitude, address: c.location_text, status: c.status_label, step: c.status_label === 'Đã phản hồi' ? 5 : 4 }))
          .filter(c => !seen.has(`${Number(c.lat).toFixed(5)},${Number(c.lng).toFixed(5)}`));
    for (const pin of [...mine, ...others]) {
      const lat = Number(pin.lat), lng = Number(pin.lng);
      if (pin.lat == null || pin.lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      const icon = L.divIcon({ className: 'google-div-icon', html: getMarkerSvg(complaintPinColor(pin.step, pin.mine), pin.mine ? 'T' : '!', false).replace('google-marker-pin', 'google-marker-pin pin-complaint'), iconSize: [38, 46], iconAnchor: [19, 46], popupAnchor: [0, -42] });
      const heading = pin.mine ? 'Kiến nghị của bạn' : isStaff() ? 'Phản ánh của người dân' : 'Vị trí có phản ánh của người dân';
      L.marker([lat, lng], { icon, title: pin.address || heading })
        .bindPopup(`<strong>${heading}</strong>${pin.title ? `<br>${esc(pin.title)}` : ''}<br>${esc(pin.address || 'Chưa rõ địa chỉ')}<br><em>${esc(pin.status || '')}</em>`)
        .addTo(complaintsLayerGroup);
    }
  }

  function updateFilterCounts() {
    const checkCount = state.permits.filter(p => p.status === 'Cần kiểm tra').length;
    const buildingCount = state.permits.filter(p => p.status === 'Đang thi công' || p.status === 'Khởi công' || p.status === 'Thi công móng' || p.status === 'Thi công khung sàn' || p.status === 'Hoàn thiện').length;
    const violationCount = state.permits.filter(p => p.status === 'Vi phạm' || p.status === 'Tạm dừng').length;
    const doneCount = state.permits.filter(p => p.status === 'Đã hoàn thành' || p.status === 'Đưa vào sử dụng' || p.done === 4).length;

    q('#count-check').textContent = checkCount;
    q('#count-building').textContent = buildingCount;
    q('#count-violation').textContent = violationCount;
    q('#count-done').textContent = doneCount;
    q('#count-complaints').textContent = state.complaints.length;
    q('#badge-tasks').textContent = checkCount;
  }

  // --- VẼ GHIM CÔNG TRÌNH CHUẨN GOOGLE MAPS PINS (SVG TEARDROP) ---
  function getMarkerSvg(color, text, isWarn = false) {
    return `
      <div class="google-marker-pin ${isWarn ? 'pin-warn' : ''}">
        <svg viewBox="0 0 38 46" width="38" height="46" fill="none">
          <path d="M19 0C8.5 0 0 8.5 0 19C0 31 19 46 19 46S38 31 38 19C38 8.5 29.5 0 19 0Z" fill="${color}"/>
          <circle cx="19" cy="18" r="11" fill="#ffffff"/>
          <text x="19" y="22" font-size="11" font-weight="bold" font-family="sans-serif" fill="${color}" text-anchor="middle">${esc(text)}</text>
        </svg>
      </div>
    `;
  }

  function renderMarkers() {
    if (!markersLayerGroup) return;
    markersLayerGroup.clearLayers();

    if (!state.showMarkers) return;

    // Lọc danh sách công trình theo filter và tìm kiếm
    let filtered = state.permits.filter(p => {
      // Tìm kiếm
      if (state.searchQuery) {
        const qStr = state.searchQuery.toLowerCase();
        const matchNum = (p.permit_number || '').toLowerCase().includes(qStr);
        const matchPlace = (p.place || '').toLowerCase().includes(qStr);
        const matchType = (p.construction_type || '').toLowerCase().includes(qStr);
        if (!matchNum && !matchPlace && !matchType) return false;
      }

      // Filter chips
      if (state.filter === 'check') return p.status === 'Cần kiểm tra';
      if (state.filter === 'building') return ['Đang thi công', 'Khởi công', 'Thi công móng', 'Thi công khung sàn', 'Hoàn thiện'].includes(p.status);
      if (state.filter === 'violation') return p.status === 'Vi phạm' || p.status === 'Tạm dừng';
      if (state.filter === 'done') return p.status === 'Đã hoàn thành' || p.status === 'Đưa vào sử dụng' || p.done === 4;
      return true;
    });

    filtered.forEach((p, idx) => {
      let lat = p.latitude;
      let lng = p.longitude;

      // Hỗ trợ mảng [lng, lat]
      if (!lat && Array.isArray(p.coord)) {
        lng = p.coord[0];
        lat = p.coord[1];
      }

      if (!lat || !lng) return;

      // Xác định màu sắc theo trạng thái Google Color System
      let color = '#1a73e8'; // Blue: Đang thi công
      let isWarn = false;

      if (p.status === 'Vi phạm' || p.status === 'Tạm dừng') {
        color = '#ea4335'; // Red: Vi phạm
        isWarn = true;
      } else if (p.status === 'Cần kiểm tra') {
        color = '#fbbc04'; // Yellow/Amber: Cần kiểm tra
        isWarn = true;
      } else if (p.status === 'Đã hoàn thành' || p.status === 'Đưa vào sử dụng' || p.done === 4) {
        color = '#34a853'; // Green: Hoàn thành
      }

      const pinNum = (p.permit_number || '').replace('/2026/GPXD', '').replace(/^0+/, '') || (idx + 1);
      const iconHtml = getMarkerSvg(color, pinNum, isWarn);

      const customIcon = L.divIcon({
        className: 'google-div-icon',
        html: iconHtml,
        iconSize: [38, 46],
        iconAnchor: [19, 46],
        popupAnchor: [0, -42]
      });

      const marker = L.marker([lat, lng], { icon: customIcon });

      // Click vào ghim: Di chuyển tâm mượt mà và mở thẻ chi tiết Google Place Card
      marker.on('click', () => {
        selectPermit(p, [lat, lng]);
      });

      marker.addTo(markersLayerGroup);
    });
  }

  // --- CHỌN VÀ HIỂN THỊ THẺ CHI TIẾT CÔNG TRÌNH (GOOGLE PLACE CARD) ---
  async function selectPermit(p, latlng) {
    const epoch = state.authEpoch;
    state.selectedPermit = p;
    if (latlng && map) map.flyTo(latlng, 17, { duration: 1.2 });
    q('#google-coord-card').style.display = 'none';
    let permitData = p;
    if (isStaff()) {
      try { const result = await api(`/api/internal/permits/${encodeURIComponent(p.id)}`); permitData = normalizePermit(result.data); }
      catch (error) { showToast(error.message); return; }
    }
    if (epoch !== state.authEpoch || state.selectedPermit?.id !== p.id) return;
    state.selectedPermit = permitData;
    q('#place-title').textContent = permitData.construction_type || 'Công trình';
    q('#place-permit-num').textContent = permitData.permit_number;
    q('#place-address').textContent = permitData.site_address || 'Chưa xác định địa chỉ';
    q('#place-status-badge').textContent = permitData.status || 'Chưa xác định';
    q('#place-tech-heading').textContent = isStaff() ? 'Thông số kỹ thuật cấp phép' : 'Giấy phép xây dựng · thông tin rút gọn';
    q('#place-stages-count').textContent = `${permitData.done}/4 mốc`;
    q('#place-stepper').innerHTML = STAGES.map((name, index) => `<div class="stepper-item ${index < permitData.done ? 'step-done' : index === permitData.done ? 'step-current' : ''}"><div class="stepper-num">${index < permitData.done ? '✓' : index + 1}</div><div class="stepper-text"><strong>${esc(name)}</strong><small>${index < permitData.done ? 'Đã duyệt kết quả kiểm tra' : 'Chưa duyệt kết quả'}</small></div></div>`).join('');
    const allSpecs = [
      ['Chiều cao công trình', permitData.building_height, 'm'], ['Số tầng', permitData.floors_text || permitData.confirmed_floors],
      ['Diện tích xây dựng', permitData.building_area, 'm²'], ['Tổng diện tích sàn', permitData.total_floor_area, 'm²'],
      ['Chỉ giới đường đỏ', permitData.red_line_setback], ['Chỉ giới xây dựng', permitData.construction_boundary || permitData.setback_text],
      ['Cốt nền', permitData.ground_elevation], ['Mật độ xây dựng', permitData.building_density, '%'],
      ['Hệ số sử dụng đất', permitData.land_use_ratio], ['Màu sắc', permitData.exterior_color]
    ];
    const specs = isStaff() ? allSpecs : allSpecs.filter(([, value]) => value !== null && value !== undefined && value !== '');
    q('#place-tech-specs').innerHTML = `<div class="compact-permit-section">${isStaff() ? `<div class="permit-meta-strip"><div class="meta-strip-item"><span class="meta-lbl">Chủ hộ / CĐT:</span><strong class="meta-val">${displayValue(permitData.owner_name)}</strong></div><div class="meta-strip-item"><span class="meta-lbl">Hạn GPXD:</span><span class="meta-val">${displayValue(permitData.expiration_date)}</span></div></div>` : `<p class="citizen-permit-note">Thông tin rút gọn từ giấy phép đã duyệt công khai.</p>`}${specs.length ? `<div class="tech-specs-compact-grid">${specs.map(([label, value, unit]) => `<div class="spec-tile"><div class="spec-tile-title">${esc(label)}</div><div class="spec-tile-text">${displayValue(value, unit)}</div></div>`).join('')}</div>` : '<p>Chưa có dữ liệu kỹ thuật được duyệt công khai.</p>'}${canApprove() ? `<button type="button" id="btn-publication" class="google-btn btn-neutral">${permitData.is_public ? 'Thu hồi công khai' : 'Duyệt công khai hồ sơ'}</button>` : ''}</div>`;
    updateAccountUi();
    if (canApprove()) q('#btn-publication').addEventListener('click', async () => {
      try {
        const result = await postJson(`/api/internal/permits/${encodeURIComponent(permitData.id)}/publication`, { is_public: !permitData.is_public, version_id: permitData.version_id });
        await fetchData();
        await selectPermit(normalizePermit(result.data));
        showToast('Đã cập nhật trạng thái công khai.');
      } catch (error) { showToast(error.message, 6000); }
    });
    q('#google-place-card').style.display = 'flex';
    q('#place-history-section').hidden = !isStaff();
    q('#place-history-list').textContent = isStaff() ? 'Đang tải lịch sử kiểm tra…' : '';
    if (isStaff()) {
      try {
        const result = await api(`/api/internal/inspections?permit_id=${encodeURIComponent(p.id)}`);
        if (epoch !== state.authEpoch || state.selectedPermit?.id !== p.id) return;
        q('#place-history-list').innerHTML = inspectionRows(result.data || []);
        bindInspectionActions(q('#place-history-list'));
      } catch (error) { if (epoch === state.authEpoch) q('#place-history-list').textContent = error.message; }
    }
  }

  // --- SỰ KIỆN CLICK BẢN ĐỒ (XEM TỌA ĐỘ / THƯỚC ĐO) ---
  function handleMapClick(e) {
    if (state.coordinatePicker) return;
    // Leaflet phát hai sự kiện click trước một double click. Bỏ qua click thứ hai.
    if (e.originalEvent && e.originalEvent.detail > 1) return;

    if (state.measureMode) {
      addMeasurePoint([e.latlng.lat, e.latlng.lng]);
    }
  }

  function handleMapDoubleClick(e) {
    if (state.coordinatePicker) {
      const { form } = state.coordinatePicker;
      state.coordinatePicker = null;
      q('#google-map').classList.remove('picking-permit-coordinates');
      form.querySelector('#permit-longitude').value = e.latlng.lng.toFixed(6);
      form.querySelector('#permit-latitude').value = e.latlng.lat.toFixed(6);
      const summary = form.querySelector('#permit-coordinate-summary');
      if (summary) summary.textContent = `Đã chọn: ${e.latlng.lat.toFixed(6)}, ${e.latlng.lng.toFixed(6)}`;
      q('#google-surface-modal').style.display = 'flex';
      q('#google-scrim').classList.add('active');
      showToast('Đã cập nhật tọa độ từ bản đồ.');
      return;
    }

    // Khi đo đạc, click đơn đặt đỉnh và double click không chọn điểm phản ánh.
    if (state.measureMode) return;

    const { lat, lng } = e.latlng;
    const coordCard = q('#google-coord-card');
    q('#coord-latlng').textContent = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
    q('#coord-address').textContent = 'Đã chọn điểm phản ánh · Phường Thảo Nguyên';
    coordCard.style.display = 'flex';
    coordCard.dataset.lat = lat;
    coordCard.dataset.lng = lng;

    q('#google-place-card').style.display = 'none';
    state.selectedPermit = null;
    showToast('Đã chọn vị trí. Có thể gửi phản ánh hoặc nhập giấy phép tại đây.');
  }

  // --- THƯỚC ĐO TRẮC ĐỊA TRÊN ẢNH VỆ TINH ---
  function setMeasureMode(mode) {
    const panel = q('#measure-panel');
    if (panel.style.display === 'none' || !panel.style.display) {
      panel.style.display = 'flex';
      state.measurePoints = [];
      if (state.measureLayer) state.measureLayer.clearLayers();
      renderSavedMeasuresList();
      const mapEl = q('#map');
      if (mapEl) mapEl.classList.add('measuring-active');
    }

    state.measureMode = mode;
    q('#btn-measure-dist').classList.toggle('active', mode === 'dist');
    q('#btn-measure-area').classList.toggle('active', mode === 'area');
    calculateMeasureResult();
  }

  function toggleMeasure() {
    const panel = q('#measure-panel');
    if (panel.style.display !== 'none' && panel.style.display) {
      closeMeasure();
    } else {
      setMeasureMode('dist');
    }
  }

  function isTextEntryTarget(target) {
    return target instanceof HTMLElement && (
      target.isContentEditable ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)
    );
  }

  function handleEscapeKey() {
    if (state.coordinatePicker) {
      state.coordinatePicker = null;
      q('#google-map').classList.remove('picking-permit-coordinates');
      q('#google-surface-modal').style.display = 'flex';
      q('#google-scrim').classList.add('active');
      showToast('Đã hủy chọn tọa độ.');
      return;
    }

    const surfaceModal = q('#google-surface-modal');
    if (surfaceModal.style.display !== 'none' && surfaceModal.style.display) {
      closeSurfaceModal();
      return;
    }

    const measurePanel = q('#measure-panel');
    if (measurePanel.style.display !== 'none' && measurePanel.style.display) {
      closeMeasure();
      return;
    }

    const drawer = q('#google-drawer');
    if (drawer.classList.contains('open')) {
      drawer.classList.remove('open');
      q('#google-scrim').classList.remove('active');
      return;
    }

    const accountPopup = q('#google-account-popup');
    if (accountPopup.classList.contains('show')) {
      accountPopup.classList.remove('show');
      return;
    }

    const layersPopup = q('#google-layers-popup');
    if (layersPopup.style.display !== 'none' && layersPopup.style.display) {
      layersPopup.style.display = 'none';
      return;
    }

    const coordCard = q('#google-coord-card');
    if (coordCard.style.display !== 'none' && coordCard.style.display) {
      coordCard.style.display = 'none';
      return;
    }

    const placeCard = q('#google-place-card');
    if (placeCard.style.display !== 'none' && placeCard.style.display) {
      placeCard.style.display = 'none';
      state.selectedPermit = null;
    }
  }

  function handleKeyboardShortcuts(event) {
    if (event.key === 'Escape') {
      handleEscapeKey();
      return;
    }

    if (!event.metaKey && !event.ctrlKey) return;
    if (event.altKey || event.shiftKey || isTextEntryTarget(event.target)) return;

    const key = event.key.toLowerCase();
    if (key === 'd') {
      event.preventDefault();
      setMeasureMode('dist');
    } else if (key === 'a') {
      event.preventDefault();
      setMeasureMode('area');
    }
  }

  function closeMeasure() {
    q('#measure-panel').style.display = 'none';
    state.measureMode = null;
    clearMeasurePoints();
    const mapEl = q('#map');
    if (mapEl) mapEl.classList.remove('measuring-active');
  }

  function clearMeasurePoints() {
    state.measurePoints = [];
    if (state.measureLayer) state.measureLayer.clearLayers();
    q('#measure-result').textContent = 'Đã xóa các điểm đo. Chạm điểm mới trên bản đồ để bắt đầu.';
  }

  function redrawMeasureLayer() {
    if (!state.measureLayer) return;
    state.measureLayer.clearLayers();

    // Vẽ lại các điểm tròn
    state.measurePoints.forEach((pt, idx) => {
      L.circleMarker(pt, {
        radius: 5,
        fillColor: idx === state.measurePoints.length - 1 ? '#ea4335' : '#1a73e8',
        color: '#ffffff',
        weight: 2,
        fillOpacity: 1
      }).addTo(state.measureLayer);
    });

    // Vẽ polyline hoặc polygon
    if (state.measurePoints.length > 1) {
      if (state.measureMode === 'dist') {
        L.polyline(state.measurePoints, {
          color: '#1a73e8',
          weight: 3,
          dashArray: '4, 6'
        }).addTo(state.measureLayer);
      } else if (state.measureMode === 'area') {
        if (state.measurePoints.length >= 3) {
          L.polygon(state.measurePoints, {
            color: '#1a73e8',
            fillColor: '#1a73e8',
            fillOpacity: 0.25,
            weight: 2.5
          }).addTo(state.measureLayer);
        } else {
          L.polyline(state.measurePoints, {
            color: '#1a73e8',
            weight: 2.5,
            dashArray: '4, 6'
          }).addTo(state.measureLayer);
        }
      }
    }

    calculateMeasureResult();
  }

  function undoMeasurePoint() {
    if (!state.measurePoints || state.measurePoints.length === 0) {
      showToast('Chưa có điểm đo nào để hoàn tác');
      return;
    }
    state.measurePoints.pop();
    redrawMeasureLayer();
    if (state.measurePoints.length === 0) {
      q('#measure-result').textContent = 'Đã hoàn tác hết điểm đo. Chạm điểm mới trên bản đồ để tiếp tục.';
    }
    showToast('↩ Đã hoàn tác điểm đo trước');
  }

  function addMeasurePoint(pt) {
    state.measurePoints.push(pt);
    redrawMeasureLayer();
  }

  function calculateMeasureResult() {
    const pts = state.measurePoints;
    const n = pts.length;
    const out = q('#measure-result');
    const parcelPermitButton = q('#btn-permit-from-parcel');
    if (parcelPermitButton) parcelPermitButton.hidden = !(canApprove() && state.measureMode === 'area' && n >= 3);

    if (state.measureMode === 'dist') {
      if (n < 2) {
        out.textContent = n === 1 ? 'Đã chấm 1 điểm. Chạm thêm điểm tiếp theo để đo khoảng cách.' : 'Chạm các điểm trên ảnh vệ tinh để đo khoảng cách...';
        return;
      }
      let totalDist = 0;
      for (let i = 1; i < n; i++) {
        totalDist += map.distance(pts[i - 1], pts[i]);
      }
      if (totalDist >= 1000) {
        out.innerHTML = `Tổng chiều dài: <strong>${(totalDist / 1000).toFixed(2)} km</strong> (${n} điểm đo)`;
      } else {
        out.innerHTML = `Tổng chiều dài: <strong>${Math.round(totalDist * 10) / 10} mét</strong> (${n} điểm đo)`;
      }
    } else if (state.measureMode === 'area') {
      if (n < 3) {
        out.textContent = `Cần ít nhất 3 điểm khép kín (đang có ${n} điểm).`;
        return;
      }
      // Tính diện tích đa giác xấp xỉ
      let area = 0;
      const R = 6378137;
      for (let i = 0; i < n; i++) {
        const p1 = pts[i];
        const p2 = pts[(i + 1) % n];
        const x1 = (p1[1] * Math.PI) / 180;
        const y1 = (p1[0] * Math.PI) / 180;
        const x2 = (p2[1] * Math.PI) / 180;
        const y2 = (p2[0] * Math.PI) / 180;
        area += (x2 - x1) * (2 + Math.sin(y1) + Math.sin(y2));
      }
      area = Math.abs((area * R * R) / 2.0);
      out.innerHTML = `Diện tích trắc địa: <strong>${Math.round(area).toLocaleString('vi-VN')} m²</strong> (${n} đỉnh đo)`;
    }
  }

  function saveCurrentMeasurement() {
    const pts = state.measurePoints;
    const n = pts.length;
    if (state.measureMode === 'dist' && n < 2) {
      showToast('⚠️ Vui lòng chấm ít nhất 2 điểm để đo khoảng cách!');
      return;
    }
    if (state.measureMode === 'area' && n < 3) {
      showToast('⚠️ Vui lòng chấm ít nhất 3 điểm để tính diện tích!');
      return;
    }

    let val = 0;
    let unit = 'm';
    let typeName = 'Khoảng cách / Khoảng lùi';

    if (state.measureMode === 'dist') {
      let totalDist = 0;
      for (let i = 1; i < n; i++) totalDist += map.distance(pts[i - 1], pts[i]);
      val = Math.round(totalDist * 10) / 10;
      unit = 'm';
      typeName = 'Khoảng lùi / Khoảng cách';
    } else {
      let area = 0;
      const R = 6378137;
      for (let i = 0; i < n; i++) {
        const p1 = pts[i];
        const p2 = pts[(i + 1) % n];
        const x1 = (p1[1] * Math.PI) / 180;
        const y1 = (p1[0] * Math.PI) / 180;
        const x2 = (p2[1] * Math.PI) / 180;
        const y2 = (p2[0] * Math.PI) / 180;
        area += (x2 - x1) * (2 + Math.sin(y1) + Math.sin(y2));
      }
      val = Math.round(Math.abs((area * R * R) / 2.0));
      unit = 'm²';
      typeName = 'Diện tích xây dựng';
    }

    const rec = {
      id: 'm_' + Date.now(),
      type: state.measureMode,
      typeName,
      value: val,
      unit,
      pointsCount: n,
      time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }),
      permit: state.selectedPermit ? (state.selectedPermit.permit_number || state.selectedPermit.id) : null
    };

    state.savedMeasurements = state.savedMeasurements || [];
    state.savedMeasurements.push(rec);
    try {
      localStorage.setItem('qlttxd_measures', JSON.stringify(state.savedMeasurements));
    } catch (e) {}

    renderSavedMeasuresList();
    showToast(`💾 Đã lưu số đo: ${val} ${unit}`);
  }

  function getParcelDetails(points) {
    const n = points.length;
    const radius = 6378137;
    let twiceArea = 0;
    let centerX = 0;
    let centerY = 0;
    const referenceLatitude = points.reduce((sum, point) => sum + point[0], 0) / n;
    const longitudeScale = Math.cos(referenceLatitude * Math.PI / 180);
    const projected = points.map(([latitude, longitude]) => [longitude * longitudeScale, latitude]);
    for (let i = 0; i < n; i++) {
      const [x1, y1] = projected[i];
      const [x2, y2] = projected[(i + 1) % n];
      const cross = x1 * y2 - x2 * y1;
      twiceArea += cross;
      centerX += (x1 + x2) * cross;
      centerY += (y1 + y2) * cross;
    }
    const areaM2 = Math.abs(twiceArea) * (Math.PI / 180 * radius) ** 2 * longitudeScale / 2;
    if (Math.abs(twiceArea) < 1e-12) {
      return {
        land_area: Math.round(areaM2),
        longitude: points.reduce((sum, point) => sum + point[1], 0) / n,
        latitude: referenceLatitude
      };
    }
    return {
      land_area: Math.round(areaM2),
      longitude: longitudeScale ? centerX / (3 * twiceArea) / longitudeScale : points[0][1],
      latitude: centerY / (3 * twiceArea)
    };
  }

  function showPermitFormFromParcel() {
    if (!canApprove() || state.measureMode !== 'area' || state.measurePoints.length < 3) return;
    showNewPermitForm(getParcelDetails(state.measurePoints), { fromParcel: true });
  }

  function saveMeasurementToInspection() {
    if (!canInspect()) return showLoginForm();
    const pts = state.measurePoints;
    const n = pts.length;
    if (state.measureMode === 'dist' && n < 2) {
      showToast('⚠️ Cần ít nhất 2 điểm đo khoảng lùi trước khi lưu vào kiểm tra!');
      return;
    }
    if (state.measureMode === 'area' && n < 3) {
      showToast('⚠️ Cần ít nhất 3 điểm đo diện tích trước khi lưu vào kiểm tra!');
      return;
    }

    if (!state.selectedPermit) {
      showToast('📍 Vui lòng nhấp chọn một công trình trên bản đồ trước để gán số đo vào phiếu kiểm tra!');
      return;
    }

    let val = 0;
    let prefill = {};
    if (state.measureMode === 'dist') {
      let totalDist = 0;
      for (let i = 1; i < n; i++) totalDist += map.distance(pts[i - 1], pts[i]);
      val = Math.round(totalDist * 10) / 10;
      prefill.actual_setback_front = val;
      prefill.measuredNote = `[Số liệu tham khảo từ ảnh vệ tinh, chưa kiểm chứng thực địa: Khoảng lùi ${val} m (${n} điểm đo)]`;
    } else {
      let area = 0;
      const R = 6378137;
      for (let i = 0; i < n; i++) {
        const p1 = pts[i];
        const p2 = pts[(i + 1) % n];
        const x1 = (p1[1] * Math.PI) / 180;
        const y1 = (p1[0] * Math.PI) / 180;
        const x2 = (p2[1] * Math.PI) / 180;
        const y2 = (p2[0] * Math.PI) / 180;
        area += (x2 - x1) * (2 + Math.sin(y1) + Math.sin(y2));
      }
      val = Math.round(Math.abs((area * R * R) / 2.0));
      prefill.actual_area = val;
      prefill.measuredNote = `[Số liệu tham khảo từ ảnh vệ tinh, chưa kiểm chứng thực địa: Diện tích ${val} m² (${n} đỉnh đo)]`;
    }

    // Mở modal kiểm tra với dữ liệu đo đạc đã nạp sẵn
    window.appStartInspection(state.selectedPermit.id || state.selectedPermit.permit_number, prefill);
    showToast(`📋 Đã thêm ghi chú số đo tham khảo ${val} ${state.measureMode === 'dist' ? 'm' : 'm²'} vào Phiếu Kiểm tra!`);
  }

  function renderSavedMeasuresList() {
    const listEl = q('#saved-measures-items');
    const wrapEl = q('#measure-saved-list');
    if (!listEl || !wrapEl) return;

    if (!state.savedMeasurements || state.savedMeasurements.length === 0) {
      wrapEl.style.display = 'none';
      listEl.innerHTML = '';
      return;
    }

    wrapEl.style.display = 'block';
    listEl.innerHTML = state.savedMeasurements.slice(-5).reverse().map(item => `
      <div class="saved-measure-item">
        <div class="saved-measure-info">
          <strong>${esc(item.value)} ${esc(item.unit)}</strong>
          <span class="saved-measure-type">${esc(item.typeName)}</span>
          ${item.permit ? `<small class="saved-measure-permit">GPXD: ${esc(item.permit)}</small>` : ''}
        </div>
        <div class="saved-measure-time">${esc(item.time)}</div>
      </div>
    `).join('');
  }

  // --- ĐỊNH VỊ GPS VỊ TRÍ HIỆN TẠI (MY LOCATION) ---
  function locateUser() {
    if (!navigator.geolocation) {
      showToast('Trình duyệt không hỗ trợ lấy vị trí GPS');
      return;
    }
    showToast('Đang dò tìm tọa độ GPS thực địa...');
    navigator.geolocation.getCurrentPosition(
      pos => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        map.flyTo([lat, lng], 18, { duration: 1.5 });

        // Tạo vòng tròn vị trí người dùng
        const myPin = L.circleMarker([lat, lng], {
          radius: 8,
          fillColor: '#1a73e8',
          color: '#ffffff',
          weight: 3,
          fillOpacity: 1
        }).addTo(map);

        myPin.bindTooltip('Vị trí thực tế của bạn', { permanent: true, direction: 'top' }).openTooltip();
        showToast('Đã định vị thành công vị trí thực tế!');
      },
      err => {
        showToast('Không thể lấy vị trí GPS: ' + err.message);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  // --- HIỂN THỊ MÀN HÌNH NỔI (GOOGLE MATERIAL SURFACE MODAL) ---
  function openSurfaceModal(title, contentHtml) {
    q('#surface-title').textContent = title;
    q('#surface-body').innerHTML = contentHtml;
    q('#google-surface-modal').style.display = 'flex';
    q('#google-scrim').classList.add('active');
    requestAnimationFrame(() => q('#surface-body').querySelector('input, button, textarea, select, a')?.focus());
  }

  function closeSurfaceModal() {
    q('#google-surface-modal').style.display = 'none';
    q('#google-scrim').classList.remove('active');
  }

  // --- HIỂN THỊ VĂN BẢN GIẤY PHÉP XÂY DỰNG A4 ĐẦY ĐỦ CÓ QR CODE (ĐIỀU 90 LUẬT XD) ---
  function showPermitA4Modal(p) {
    if (!p) return;
    const rows = [['Số giấy phép', p.permit_number], ['Ngày cấp', p.issue_date], ['Địa điểm xây dựng', p.site_address], ['Loại công trình', p.construction_type], ['Diện tích xây dựng (m²)', p.building_area], ['Tổng diện tích sàn (m²)', p.total_floor_area], ['Số tầng', p.floors_text], ['Khoảng lùi', p.setback_text], ['Trạng thái', p.status]];
    if (isStaff()) rows.splice(2, 0, ['Chủ hộ / Chủ đầu tư', p.owner_name], ['Địa chỉ chủ hộ', p.owner_address]);
    openSurfaceModal('Phiếu thông tin công trình', `<article class="permit-print"><h2>PHIẾU THÔNG TIN CÔNG TRÌNH</h2><p class="notice">Bản thử nghiệm — thông tin trích xuất, không thay thế giấy phép xây dựng gốc hoặc văn bản đã ký.</p><dl>${rows.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${displayValue(value)}</dd></div>`).join('')}</dl>${p.is_public || !isStaff() ? `<img src="/api/public/permits/${encodeURIComponent(p.id)}/qrcode" width="120" height="120" alt="Mã QR tra cứu thông tin công khai">` : '<p>Hồ sơ chưa được duyệt công khai.</p>'}<button type="button" id="btn-print-record" class="google-btn btn-primary no-print">In phiếu thông tin</button></article>`);
    q('#btn-print-record').addEventListener('click', () => window.print());
  }

  function inspectionRows(list) {
    if (!list.length) return '<p>Chưa có phiếu kiểm tra.</p>';
    return list.map(insp => `<article class="record-row"><strong>${esc(insp.stage_name || STAGES[insp.stage_index])}</strong><p>${esc(insp.inspect_date)} · ${esc({draft:'Bản nháp',pending_approval:'Chờ duyệt',approved:'Đã duyệt'}[insp.status] || insp.status)}</p><a class="google-btn btn-neutral btn-sm" href="/api/internal/inspections/${encodeURIComponent(insp.id)}/print" target="_blank" rel="noopener">Xem / in phiếu</a>${canApprove() && insp.status === 'pending_approval' ? `<button class="google-btn btn-primary btn-sm" data-approve-inspection="${esc(insp.id)}">Duyệt kết quả</button>` : ''}</article>`).join('');
  }

  function bindInspectionActions(container) {
    container.querySelectorAll('[data-approve-inspection]').forEach(button => button.addEventListener('click', async () => {
      if (!canApprove() || !state.selectedPermit) return;
      button.disabled = true;
      try {
        await postJson(`/api/internal/inspections/${encodeURIComponent(button.dataset.approveInspection)}/approve`, { version_id: state.selectedPermit.version_id });
        const id = state.selectedPermit.id;
        await fetchData();
        const updated = state.permits.find(p => p.id === id);
        if (updated) await selectPermit(updated);
        showToast('Đã duyệt kết quả kiểm tra.');
      } catch (error) { showToast(error.message, 6000); }
      finally { button.disabled = false; }
    }));
  }

  function showPermitList() {
    const term = state.searchQuery.toLocaleLowerCase('vi-VN');
    const list = state.permits.filter(p => [p.permit_number,p.site_address,p.construction_type].some(v => String(v || '').toLocaleLowerCase('vi-VN').includes(term)));
    const unpublished = canApprove() ? state.permits.filter(p => !p.is_public && p.latitude != null && p.longitude != null).length : 0;
    openSurfaceModal('Danh sách công trình', `<p>${list.length} hồ sơ${isStaff() ? ' trong phạm vi quản lý' : ' đã duyệt công khai'}.</p>${unpublished ? `<p><button type="button" id="btn-publish-all" class="google-btn btn-primary">Công bố ${unpublished} hồ sơ đã có vị trí lên bản đồ công khai</button></p>` : ''}${list.map(p => `<article class="record-row"><strong>${esc(p.permit_number)}</strong><p>${esc(p.site_address)}</p><p>${esc(p.status)} · ${p.done}/4 mốc</p><button type="button" class="google-btn btn-primary btn-sm" data-open-permit="${esc(p.id)}">Xem hồ sơ</button></article>`).join('') || '<p>Chưa tìm thấy công trình phù hợp.</p>'}`);
    q('#btn-publish-all')?.addEventListener('click', async event => {
      const button = event.currentTarget;
      if (!window.confirm(`Công bố ${unpublished} hồ sơ lên bản đồ công khai? Người dân sẽ thấy số giấy phép, địa chỉ, vị trí, chỉ giới, số tầng, diện tích và chiều cao.`)) return;
      button.disabled = true;
      try {
        const result = await postJson('/api/internal/permits/publish-all', {}, uniqueKey('publish-all'));
        await fetchData();
        showToast(`Đã công bố ${result.data.published} hồ sơ.`);
        showPermitList();
      } catch (error) { button.disabled = false; showToast(error.message, 6000); }
    });
    q('#surface-body').querySelectorAll('[data-open-permit]').forEach(button => button.addEventListener('click', () => {
      const p = state.permits.find(item => item.id === button.dataset.openPermit);
      if (p) { closeSurfaceModal(); selectPermit(p, p.latitude && p.longitude ? [p.latitude,p.longitude] : null); }
    }));
  }

  function showTasksScreen() {
    if (!isStaff()) return showLoginForm();
    const list = state.permits.filter(p => p.done < 4);
    openSurfaceModal('Công việc và bản nháp kiểm tra', `<p>Chọn hồ sơ để lập phiếu hoặc xem kết quả đang chờ duyệt.</p><div class="record-list">${list.map(p => `<article class="record-row"><strong>${esc(p.permit_number)}</strong><p>${esc(p.site_address)}</p><div class="form-actions"><button type="button" class="google-btn btn-neutral btn-sm" data-review-permit="${esc(p.id)}">Lịch sử / duyệt phiếu</button>${canInspect() ? `<button type="button" class="google-btn btn-primary btn-sm" data-inspect-permit="${esc(p.id)}">Lập phiếu kiểm tra</button>` : ''}</div></article>`).join('') || '<p>Chưa có hồ sơ cần kiểm tra.</p>'}</div><h3>Bản nháp trên thiết bị của bạn (${state.offlineDrafts.length})</h3><p>Ảnh phải được tải lên khi có mạng. Nháp chỉ được xóa sau khi máy chủ xác nhận đã lưu phiếu.</p>${state.offlineDrafts.map(d => `<article class="record-row"><strong>${esc(d.permit_number || d.permit_id)}</strong><p>${esc(STAGES[d.stage_index])} · ${esc(new Date(d.saved_at).toLocaleString('vi-VN'))}</p><button class="google-btn btn-neutral btn-sm" data-edit-draft="${esc(d.idempotency_key)}">Mở nháp / bổ sung ảnh</button><button class="google-btn btn-primary btn-sm" data-sync-draft="${esc(d.idempotency_key)}">${d.status === 'draft' ? 'Đồng bộ nháp' : 'Gửi duyệt'}</button></article>`).join('')}`);
    q('#surface-body').querySelectorAll('[data-inspect-permit]').forEach(button => button.addEventListener('click', () => window.appStartInspection(button.dataset.inspectPermit)));
    q('#surface-body').querySelectorAll('[data-review-permit]').forEach(button => button.addEventListener('click', () => {
      const p = state.permits.find(item => item.id === button.dataset.reviewPermit);
      if (p) { closeSurfaceModal(); selectPermit(p); }
    }));
    q('#surface-body').querySelectorAll('[data-edit-draft]').forEach(button => button.addEventListener('click', () => {
      const draft = state.offlineDrafts.find(d => d.idempotency_key === button.dataset.editDraft);
      if (draft) window.appStartInspection(draft.permit_id, { draft });
    }));
    q('#surface-body').querySelectorAll('[data-sync-draft]').forEach(button => button.addEventListener('click', () => window.appSyncDraft(button.dataset.syncDraft)));
  }

  async function showReportsScreen() {
    if (!isStaff()) return showLoginForm();
    const epoch = state.authEpoch;
    openSurfaceModal('Thống kê địa bàn', '<p>Đang tải báo cáo…</p>');
    try {
      const result = await api('/api/internal/reports/sub-areas');
      if (epoch !== state.authEpoch) return;
      const rows = result.data || [];
      q('#surface-body').innerHTML = `<p><a class="google-btn btn-neutral" href="/api/internal/reports/export-csv" download>Xuất báo cáo CSV</a></p><div class="table-scroll"><table class="app-table"><thead><tr><th>Tổ dân phố</th><th>Công trình</th><th>Đang theo dõi</th><th>Hoàn thành</th><th>Phản ánh</th><th>Vi phạm</th></tr></thead><tbody>${rows.map(row => `<tr>${[row.groupName,row.totalPermits,row.activePermits,row.completedPermits,row.complaintsCount,row.violationsCount].map(value => `<td>${displayValue(value)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    } catch (error) { if (epoch === state.authEpoch) q('#surface-body').textContent = error.message; }
  }

  async function showSettingsScreen() {
    if (state.role !== 'admin') return;
    const epoch = state.authEpoch;
    openSurfaceModal('Nhật ký kiểm toán', '<p>Đang tải nhật ký…</p>');
    try {
      const result = await api('/api/internal/audit-logs?limit=100');
      if (epoch !== state.authEpoch) return;
      q('#surface-body').innerHTML = `<p><a class="google-btn btn-neutral" href="/api/internal/reports/audit-logs/export-csv" download>Xuất nhật ký CSV</a></p><div class="table-scroll"><table class="app-table"><thead><tr><th>Thời điểm</th><th>Cán bộ</th><th>Thao tác</th><th>Đối tượng</th></tr></thead><tbody>${(result.data || []).map(row => `<tr><td>${esc(new Date(row.created_at).toLocaleString('vi-VN'))}</td><td>${esc(row.user_full_name || row.user_id)}</td><td>${esc(row.action)}</td><td>${esc(row.entity_type)} · ${esc(row.entity_id)}</td></tr>`).join('')}</tbody></table></div>`;
    } catch (error) { if (epoch === state.authEpoch) q('#surface-body').textContent = error.message; }
  }

  function showComplaintForm(prefillCoords = null) {
    const p = state.selectedPermit;
    const lat = prefillCoords?.lat ?? p?.latitude ?? '';
    const lng = prefillCoords?.lng ?? p?.longitude ?? '';
    const key = uniqueKey('complaint');
    let submittedPayload = null;
    openSurfaceModal('Gửi phản ánh hiện trường', `<form id="form-complaint" class="app-form"><p>Nhập đúng vị trí và nội dung. Bạn sẽ nhận mã bí mật để tra cứu kết quả.</p>
      <label for="comp-title">Tiêu đề *</label><input id="comp-title" required maxlength="200">
      <label for="comp-content">Nội dung *</label><textarea id="comp-content" rows="4" required maxlength="10000"></textarea>
      <label for="comp-location">Địa điểm *</label><input id="comp-location" value="${esc(prefillCoords ? '' : p?.site_address || '')}" required maxlength="500">
      <div class="form-grid"><div><label for="comp-lng">Kinh độ *</label><input type="number" step="any" id="comp-lng" value="${esc(lng)}" min="-180" max="180" required></div><div><label for="comp-lat">Vĩ độ *</label><input type="number" step="any" id="comp-lat" value="${esc(lat)}" min="-90" max="90" required></div></div>
      <p id="complaint-error" class="form-error" role="alert"></p><button class="google-btn btn-primary" type="submit">Gửi phản ánh</button></form>`);
    q('#form-complaint').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      if (form.dataset.busy) return;
      form.dataset.busy = '1';
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      q('#complaint-error').textContent = 'Đang gửi…';
      submittedPayload ||= { title:q('#comp-title').value.trim(),content:q('#comp-content').value.trim(),location_text:q('#comp-location').value.trim(),longitude:Number(q('#comp-lng').value),latitude:Number(q('#comp-lat').value),is_anonymous:true };
      try {
        const result = await postJson('/api/public/complaints', submittedPayload, key);
        if (!result.data?.id || !result.data?.lookup_code) throw new Error('Máy chủ chưa trả mã tra cứu. Hãy giữ biểu mẫu và gửi lại.');
        const code = result.data.lookup_code;
        const remembered = rememberComplaintCode(code);
        fetchComplaintPins();
        openSurfaceModal('Đã tiếp nhận phản ánh', `<p>${remembered ? 'Mã tra cứu đã được lưu trên trình duyệt này. Bạn vẫn nên ghi lại để tra cứu trên thiết bị khác.' : 'Hãy ghi lại mã bí mật để tự tra cứu; trình duyệt này không lưu được mã.'}</p><p class="lookup-code">${esc(code)}</p><div class="form-actions"><button id="btn-lookup-submitted" class="google-btn btn-neutral">Tra cứu tiến độ</button><button id="btn-my-complaints-submitted" class="google-btn btn-primary">Kiến nghị của tôi</button></div>`);
        q('#btn-lookup-submitted').addEventListener('click', () => showLookupForm(code));
        q('#btn-my-complaints-submitted').addEventListener('click', showMyComplaintsScreen);
      } catch (error) {
        if (error.status && error.status < 500) submittedPayload = null;
        q('#complaint-error').textContent = `${error.message} Nội dung chưa được xác nhận đã lưu. Giữ biểu mẫu và bấm gửi lại để dùng cùng mã chống lặp.`;
      } finally { delete form.dataset.busy; button.disabled = false; }
    });
  }

  function showLookupForm(initialCode = '') {
    openSurfaceModal('Tra cứu phản ánh', `<form id="form-lookup" class="app-form"><label for="lookup-code">Mã bí mật đã nhận khi gửi</label><input id="lookup-code" value="${esc(initialCode)}" autocomplete="off" required><button class="google-btn btn-primary">Tra cứu</button></form><div id="lookup-result" role="status"></div>`);
    const lookup = async () => {
      q('#lookup-result').textContent = 'Đang tra cứu…';
      try {
        const result = await api(`/api/public/complaints/lookup?code=${encodeURIComponent(q('#lookup-code').value.trim())}`);
        const c = result.data;
        rememberComplaintCode(q('#lookup-code').value.trim());
        q('#lookup-result').innerHTML = `<article class="record-row"><strong>${esc(c.title)}</strong><p>${esc(c.status_label || c.status)}</p><p>${esc(c.location_text)}</p><p>${esc(c.content)}</p><h3>Kết quả được duyệt</h3><p>${esc(c.official_reply || c.reply || 'Chưa có phản hồi được duyệt.')}</p><button type="button" id="btn-my-complaints-lookup" class="google-btn btn-neutral">Xem kiến nghị của tôi</button></article>`;
        q('#btn-my-complaints-lookup').addEventListener('click', showMyComplaintsScreen);
      } catch (error) { q('#lookup-result').textContent = error.message; }
    };
    q('#form-lookup').addEventListener('submit', event => { event.preventDefault(); lookup(); });
    if (initialCode) lookup();
  }

  function showMyComplaintsScreen() {
    openSurfaceModal('Kiến nghị của tôi', `<p>Các phản ánh đã gửi trên trình duyệt này. Nhập mã bí mật để thêm phản ánh đã gửi ở thiết bị khác.</p><form id="form-add-my-complaint" class="app-form"><label for="my-complaint-code">Mã tra cứu bí mật</label><input id="my-complaint-code" placeholder="TN-DEMO-…" autocomplete="off" required><button type="submit" class="google-btn btn-neutral">Thêm phản ánh bằng mã</button></form><div id="my-complaints-list" class="my-complaints-list" aria-live="polite"></div>`);
    const list = q('#my-complaints-list');
    let loadRevision = 0;

    const render = (rows, codes) => {
      if (!rows.length) {
        list.innerHTML = '<p class="citizen-permit-note">Chưa có phản ánh được lưu trên trình duyệt này. Nhập mã bí mật ở trên để tìm phản ánh đã gửi.</p>';
        return;
      }
      list.innerHTML = rows.map((row, index) => row.error
        ? `<article class="my-complaint-card"><strong>Không tra cứu được phản ánh</strong><p>${esc(row.error)}</p><button type="button" class="google-btn btn-neutral btn-sm" data-remove-my-complaint="${index}">Bỏ mã khỏi danh sách này</button></article>`
        : `<article class="my-complaint-card"><div class="my-complaint-heading"><strong>${esc(row.complaint.title || 'Phản ánh hiện trường')}</strong><span class="google-badge badge-neutral">${esc(row.complaint.status_label || 'Đang xử lý')}</span></div><p class="my-complaint-location">${esc(row.complaint.location_text || 'Chưa có địa điểm')}</p><p>${esc(row.complaint.content || '')}</p><small>Gửi lúc ${esc(new Date(row.complaint.created_at).toLocaleString('vi-VN'))}</small>${row.complaint.official_reply ? `<div class="my-complaint-reply"><strong>Phản hồi đã được duyệt</strong><p>${esc(row.complaint.official_reply)}</p></div>` : '<p class="my-complaint-pending">Chưa có phản hồi được duyệt.</p>'}<button type="button" class="google-btn btn-neutral btn-sm" data-remove-my-complaint="${index}">Bỏ khỏi danh sách trên thiết bị này</button></article>`
      ).join('');
      list.querySelectorAll('[data-remove-my-complaint]').forEach(button => button.addEventListener('click', () => {
        const code = codes[Number(button.dataset.removeMyComplaint)];
        if (code) forgetComplaintCode(code);
        load();
      }));
    };

    const load = async () => {
      const revision = ++loadRevision;
      const codes = savedComplaintCodes();
      if (!codes.length) { render([], codes); return; }
      list.textContent = 'Đang tải trạng thái kiến nghị…';
      const rows = [];
      for (const code of codes) {
        if (q('#my-complaints-list') !== list || revision !== loadRevision) return;
        try {
          const result = await api(`/api/public/complaints/lookup?code=${encodeURIComponent(code)}`);
          rows.push({ complaint: result.data });
        } catch (error) { rows.push({ error: error.message }); }
      }
      if (q('#my-complaints-list') === list && revision === loadRevision) render(rows, codes);
    };

    q('#form-add-my-complaint').addEventListener('submit', async event => {
      event.preventDefault();
      const form = event.currentTarget;
      const codeInput = q('#my-complaint-code');
      const code = codeInput.value.trim().toUpperCase();
      const button = form.querySelector('button[type="submit"]');
      if (!/^TN-DEMO-[A-F0-9]{32}$/.test(code)) {
        showToast('Mã tra cứu cần có dạng TN-DEMO- theo sau bởi 32 ký tự chữ hoặc số.');
        return;
      }
      button.disabled = true;
      try {
        const result = await api(`/api/public/complaints/lookup?code=${encodeURIComponent(code)}`);
        const remembered = rememberComplaintCode(code);
        codeInput.value = '';
        showToast(remembered ? `Đã thêm: ${result.data.status_label || 'đang xử lý'}.` : 'Đã tra cứu được, nhưng trình duyệt không lưu được mã này.');
        if (remembered) await load();
        else render([{ complaint: result.data }], [code]);
      } catch (error) {
        showToast(error.message, 6000);
      } finally { button.disabled = false; }
    });

    load();
  }

  async function showComplaintsScreen() {
    if (!isStaff()) return showLookupForm();
    const epoch = state.authEpoch;
    openSurfaceModal('Tiếp nhận và xử lý phản ánh', '<p>Đang tải phản ánh…</p>');
    try {
      const result = await api('/api/internal/complaints');
      if (epoch !== state.authEpoch) return;
      state.complaints = result.data || [];
      updateFilterCounts();
      renderComplaintPins();
      q('#surface-body').innerHTML = state.complaints.map(c => {
        const next = Number(c.status_step) + 1;
        const canStep = next <= 5 && (next <= 2 ? canReceive() : next === 5 ? canApprove() : canInspect());
        return `<article class="record-row"><strong>${esc(c.title)}</strong><p>${esc(c.location_text)} · ${esc(c.status_label)}</p><p>${esc(c.content)}</p>${canStep ? `<button class="google-btn btn-primary btn-sm" data-step-complaint="${esc(c.id)}">${['','Tiếp nhận','Phân công','Bắt đầu kiểm tra','Trình duyệt','Duyệt phản hồi'][next]}</button>` : ''}</article>`;
      }).join('') || '<p>Chưa có phản ánh.</p>';
      q('#surface-body').querySelectorAll('[data-step-complaint]').forEach(button => button.addEventListener('click', () => showComplaintStep(state.complaints.find(c => c.id === button.dataset.stepComplaint))));
    } catch (error) { if (epoch === state.authEpoch) q('#surface-body').textContent = error.message; }
  }

  function showComplaintStep(c) {
    if (!c || !isStaff()) return;
    const step = Number(c.status_step) + 1;
    const key = uniqueKey('complaint-step');
    openSurfaceModal('Cập nhật phản ánh', `<form id="form-complaint-step" class="app-form"><strong>${esc(c.title)}</strong><p>${esc(c.content)}</p>${step === 2 ? '<label for="step-assignee">Mã tài khoản cán bộ được phân công</label><input id="step-assignee" required>' : ''}<label for="step-notes">Ghi chú xử lý</label><textarea id="step-notes">${esc(c.investigation_notes || '')}</textarea>${step >= 4 ? `<label for="step-reply">Nội dung phản hồi đề xuất</label><textarea id="step-reply" required>${esc(c.official_reply || '')}</textarea>` : ''}${step === 5 ? '<label><input type="checkbox" id="step-approved-read" required> Tôi đã đọc và xác nhận nội dung phản hồi được công bố cho người gửi</label>' : ''}<p id="step-error" class="form-error" role="alert"></p><button class="google-btn btn-primary">Lưu chuyển bước</button></form>`);
    q('#form-complaint-step').addEventListener('submit', async event => {
      event.preventDefault();
      try {
        await postJson(`/api/internal/complaints/${encodeURIComponent(c.id)}/step`, { step, version_id:c.version_id, notes:q('#step-notes').value, assigned_to:step===2?q('#step-assignee').value.trim():undefined, reply:step>=4?q('#step-reply').value:undefined, approved_read:step===5?q('#step-approved-read').checked:undefined }, key);
        await showComplaintsScreen();
      } catch (error) { q('#step-error').textContent = error.message; }
    });
  }

  function showNewPermitForm(prefill = {}, options = {}) {
    if (!canApprove()) return;
    const epoch = state.authEpoch;
    const required = [['permit_number','Số giấy phép','text'],['issue_date','Ngày cấp','date'],['issuing_authority','Cơ quan cấp','text'],['owner_name','Chủ đầu tư / chủ hộ','text'],['site_address','Địa chỉ công trình','text'],['construction_type','Loại công trình','text']];
    const optional = [['owner_address','Địa chỉ chủ đầu tư','text'],['land_lot','Thửa đất','text'],['land_use_cert','Giấy tờ đất','text'],['land_area','Diện tích đất (m²)','number'],['building_area','Diện tích xây dựng (m²)','number'],['total_floor_area','Tổng diện tích sàn (m²)','number'],['land_use_ratio','Hệ số sử dụng đất','number'],['floors_text','Số tầng theo giấy phép','text'],['confirmed_floors','Số tầng xác nhận','integer'],['basement_floors','Số tầng hầm','integer'],['mezzanine_floors','Số tầng lửng','integer'],['building_height','Chiều cao công trình (m)','number'],['building_density','Mật độ xây dựng (%)','number'],['setback_text','Khoảng lùi','text'],['red_line_setback','Chỉ giới đường đỏ','text'],['construction_boundary','Chỉ giới xây dựng','text'],['ground_elevation','Cốt nền','text'],['exterior_color','Màu sắc công trình','text'],['design_by','Đơn vị thiết kế','text'],['design_doc','Hồ sơ thiết kế','text'],['expiration_date','Ngày hết hạn','date']];
    const fields = [...required, ...optional, ['longitude','Kinh độ','coordinate'], ['latitude','Vĩ độ','coordinate']];
    const input = ([name,label,type], needed = false) => `<div><label for="permit-${name}">${label}${needed ? ' *' : ''}</label><input id="permit-${name}" type="${['integer','coordinate'].includes(type) ? 'number' : type}" ${needed ? 'required' : ''} ${['number','integer','coordinate'].includes(type) ? `step="${type === 'integer' ? '1' : 'any'}" ${type === 'coordinate' ? '' : 'min="0"'}` : ''}></div>`;
    let key = uniqueKey('permit');
    let submittedPayload = null;
    openSurfaceModal('Nhập giấy phép đã cấp', `<form id="form-permit" class="app-form"><p>Chọn công bố ngay để hồ sơ có vị trí hiện trên bản đồ của người dân, hoặc bỏ chọn để lưu nội bộ và công bố sau.</p><div class="form-grid">${required.map(field=>input(field,true)).join('')}</div><h3>Chỉ tiêu theo giấy phép</h3><p>Chỉ nhập thông tin có trên hồ sơ; có thể để trống mục chưa xác định.</p><div class="form-grid">${optional.map(field=>input(field)).join('')}</div><h3>Vị trí công trình</h3><p>Chọn điểm trên bản đồ hoặc nhập kinh độ, vĩ độ. Nếu vừa vẽ khu đất, tọa độ tâm và diện tích ước tính sẽ được điền sẵn; vui lòng đối chiếu giấy phép trước khi lưu.</p><div class="form-grid">${fields.slice(-2).map(field=>input(field)).join('')}</div><button type="button" id="permit-pick-coordinate" class="google-btn btn-neutral">📍 Chọn tọa độ trên bản đồ</button><p id="permit-coordinate-summary" class="coordinate-summary">${prefill.latitude != null && prefill.longitude != null ? `Tọa độ đã chọn: ${Number(prefill.latitude).toFixed(6)}, ${Number(prefill.longitude).toFixed(6)}` : 'Chưa chọn tọa độ trên bản đồ.'}</p><label class="layer-checkbox"><input type="checkbox" id="permit-publish" checked><span>Công bố ngay lên bản đồ công khai. Người dân chỉ thấy số giấy phép, địa chỉ, vị trí, chỉ giới xây dựng, chỉ giới đường đỏ, số tầng, diện tích và chiều cao; không thấy chủ đầu tư hay giấy tờ đất.</span></label><p id="permit-error" class="form-error" role="alert"></p><button type="submit" class="google-btn btn-primary">Lưu hồ sơ</button></form>`);
    const form = q('#form-permit');
    for (const name of ['longitude', 'latitude', 'land_area']) {
      if (prefill[name] != null && Number.isFinite(Number(prefill[name]))) form.querySelector(`#permit-${name}`).value = String(prefill[name]);
    }
    q('#permit-pick-coordinate').addEventListener('click', () => {
      state.coordinatePicker = { form };
      q('#google-surface-modal').style.display = 'none';
      q('#google-scrim').classList.remove('active');
      q('#google-coord-card').style.display = 'none';
      q('#google-map').classList.add('picking-permit-coordinates');
      showToast('Nhấp đúp vào vị trí công trình trên bản đồ. Nhấn Esc để hủy.');
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (form.dataset.busy || epoch !== state.authEpoch || q('#form-permit') !== form) return;
      form.dataset.busy='1';
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      if (!submittedPayload) submittedPayload = Object.fromEntries(fields.map(([name,,type]) => [name, ['number','integer','coordinate'].includes(type) ? nullableNumber(`#permit-${name}`) : q(`#permit-${name}`).value.trim()]));
      submittedPayload.publish = q('#permit-publish')?.checked === true;
      form.querySelectorAll('input').forEach(input => { input.disabled = true; });
      let saved = false;
      try {
        const result=await postJson('/api/internal/permits',submittedPayload,key);
        if(!result.data?.id) throw new Error('Chưa nhận được mã hồ sơ.');
        saved = true;
        if (epoch !== state.authEpoch || q('#form-permit') !== form) return;
        if (options.fromParcel) closeMeasure();
        closeSurfaceModal();await fetchData();await selectPermit(normalizePermit(result.data));
      } catch(error) {
        if (epoch !== state.authEpoch || q('#form-permit') !== form) return;
        if (error.status && error.status < 500) {
          submittedPayload = null; key = uniqueKey('permit');
          form.querySelectorAll('input').forEach(input => { input.disabled = false; });
        }
        q('#permit-error').textContent = error.message + (submittedPayload && !saved ? ' Bấm lưu lại để kiểm tra cùng hồ sơ, tránh tạo bản trùng.' : '');
      } finally { delete form.dataset.busy; button.disabled = false; }
    });
  }

  function showBatchForm() {
    if(!canApprove())return;
    const epoch = state.authEpoch;
    let preview = null;
    let revision = 0;
    let filename = 'import.csv';
    let key = uniqueKey('import');
    let submittedPayload = null;
    let committing = false;
    openSurfaceModal('Nhập danh sách giấy phép từ CSV', `<form id="form-batch" class="app-form"><p>Cột bắt buộc: số giấy phép, ngày cấp, cơ quan cấp, chủ hộ, địa điểm, loại công trình, kinh độ, vĩ độ. Hãy xem trước và sửa hết lỗi trước khi nhập.</p><p><a href="/mau-nhap-giay-phep.csv" download>Tải tệp CSV mẫu</a>. Hỗ trợ CSV UTF-8 dùng dấu phẩy, chấm phẩy hoặc tab; ngày dạng ngày/tháng/năm hoặc năm-tháng-ngày. Tệp Excel cần lưu thành CSV trước khi chọn.</p><label for="batch-file">Chọn tệp CSV UTF-8</label><input type="file" id="batch-file" accept=".csv,text/csv" required><button type="submit" class="google-btn btn-neutral">Kiểm tra và xem trước</button></form><label class="layer-checkbox"><input type="checkbox" id="batch-publish" checked><span>Công bố ngay lên bản đồ công khai. Người dân chỉ thấy số giấy phép, địa chỉ, vị trí, chỉ giới xây dựng, chỉ giới đường đỏ, số tầng, diện tích và chiều cao; không thấy chủ đầu tư hay giấy tờ đất.</span></label><div id="batch-preview"></div><p id="batch-error" class="form-error" role="alert"></p><button id="batch-commit" class="google-btn btn-primary" hidden>Nhập các hồ sơ đã kiểm tra</button>`);
    const form = q('#form-batch');
    const fileInput = q('#batch-file');
    const previewButton = form.querySelector('button[type="submit"]');
    const active = () => epoch === state.authEpoch && q('#form-batch') === form;
    const invalidate = () => {
      revision++; preview = null; key = uniqueKey('import');
      q('#batch-commit').hidden = true;
      q('#batch-preview').textContent = '';
      q('#batch-error').textContent = '';
    };
    form.addEventListener('submit',async event=>{
      event.preventDefault();
      if (!active() || committing || submittedPayload) return;
      invalidate();
      const current = revision;
      const file = fileInput.files[0];
      try {
        if(!file || !/\.csv$/i.test(file.name) || file.size>2*1024*1024)throw new Error('Chọn tệp CSV tối đa 2 MB.');
        q('#batch-error').textContent = 'Đang kiểm tra tệp…';
        const csvText = await file.text();
        if (!active() || current !== revision || fileInput.files[0] !== file) return;
        const result=await postJson('/api/internal/batch-import/preview',{csvText});
        if (!active() || current !== revision || fileInput.files[0] !== file) return;
        preview=result.data; filename=file.name;
        if (!preview || !Array.isArray(preview.previewRows)) throw new Error('Máy chủ chưa trả kết quả kiểm tra hợp lệ.');
        q('#batch-preview').innerHTML=`<p>${esc(preview.validCount)} dòng hợp lệ; ${esc(preview.errorCount)} dòng lỗi.</p><div class="table-scroll"><table class="app-table"><thead><tr><th>Dòng</th><th>Số giấy phép</th><th>Địa chỉ</th><th>Kết quả kiểm tra</th></tr></thead><tbody>${preview.previewRows.map(row=>`<tr><td>${esc(row.rowNumber)}</td><td>${esc(row.data?.permit_number)}</td><td>${esc(row.data?.site_address)}</td><td>${row.isValid?'Hợp lệ':esc((row.errors||[]).map(e=>e.message).join('; '))}</td></tr>`).join('')}</tbody></table></div>`;
        q('#batch-commit').hidden=!(preview.validCount>0 && preview.errorCount===0);
        q('#batch-error').textContent=preview.success === false ? (preview.errors || []).map(error=>error.message).join('; ') : '';
      }catch(error){if (active() && current === revision) { preview=null;q('#batch-commit').hidden=true;q('#batch-error').textContent=error.message; }}
    });
    fileInput.addEventListener('change',()=>{ if (active() && !committing && !submittedPayload) invalidate(); });
    q('#batch-commit').addEventListener('click',async event=>{
      if(!active() || committing || !preview || preview.errorCount || !preview.validCount)return;
      const button=event.currentTarget;
      committing = true;button.disabled=true;fileInput.disabled=true;previewButton.disabled=true;
      submittedPayload ||= {validRows:preview.previewRows.map(row=>row.data),filename,publish:q('#batch-publish')?.checked===true};
      try{
        const result=await postJson('/api/internal/batch-import/commit',submittedPayload,key);
        if(!result.data?.batchId)throw new Error('Chưa nhận được mã lô nhập.');
        if (!active()) return;
        closeSurfaceModal();await fetchData();showToast(`Đã nhập ${result.data.importedCount} hồ sơ${submittedPayload.publish ? ' và công bố công khai' : ' nội bộ'}.`);
      }catch(error){
        if (!active()) return;
        if (error.status && error.status < 500) { submittedPayload = null; invalidate(); }
        q('#batch-error').textContent=error.message + (submittedPayload ? ' Bấm nhập lại để xác nhận cùng lô hồ sơ, tránh nhập trùng.' : ' Hãy kiểm tra và xem trước lại tệp.');
      }finally{
        committing=false;button.disabled=false;
        fileInput.disabled=Boolean(submittedPayload);previewButton.disabled=Boolean(submittedPayload);
      }
    });
  }

  async function showViolationsScreen() {
    if(!isStaff())return;
    const epoch=state.authEpoch;
    openSurfaceModal('Biên bản vi phạm','<p>Đang tải biên bản…</p>');
    try {
      const result=await api('/api/internal/violations');
      if(epoch!==state.authEpoch)return;
      q('#surface-body').innerHTML=(result.data||[]).map(v=>`<article class="record-row"><strong>${esc(v.permit_number || v.permit_id)}</strong><p>${esc(v.violation_type || v.description)}</p><p>${esc(v.status)}</p><a class="google-btn btn-neutral btn-sm" href="/api/internal/violations/${encodeURIComponent(v.id)}/print" target="_blank" rel="noopener">Xem / in biên bản</a></article>`).join('')||'<p>Chưa có biên bản vi phạm.</p>';
    }catch(error){if(epoch===state.authEpoch)q('#surface-body').textContent=error.message;}
  }

  // --- THIẾT LẬP CÁC SỰ KIỆN TƯƠNG TÁC GIAO DIỆN ---
  function setupEventListeners() {
    // 1. Mở/Đóng Side Drawer
    q('#btn-menu').addEventListener('click', () => {
      q('#google-drawer').classList.add('open');
      q('#google-scrim').classList.add('active');
    });

    q('#btn-drawer-close').addEventListener('click', () => {
      q('#google-drawer').classList.remove('open');
      q('#google-scrim').classList.remove('active');
    });

    q('#google-scrim').addEventListener('click', () => {
      q('#google-drawer').classList.remove('open');
      closeSurfaceModal();
      q('#google-account-popup').classList.remove('show');
    });

    // 2. Chuyển đổi Vai trò người dùng (Account Popup)
    q('#btn-account').addEventListener('click', e => {
      e.stopPropagation();
      q('#google-account-popup').classList.toggle('show');
    });

    document.addEventListener('click', e => {
      if (!q('#google-account-popup').contains(e.target) && e.target !== q('#btn-account')) {
        q('#google-account-popup').classList.remove('show');
      }
    });

    q('#btn-login').addEventListener('click', () => { q('#google-account-popup').classList.remove('show'); showLoginForm(); });
    q('#btn-logout').addEventListener('click', () => { q('#google-account-popup').classList.remove('show'); logout(); });
    q('#btn-my-complaints-account').addEventListener('click', () => { q('#google-account-popup').classList.remove('show'); showMyComplaintsScreen(); });

    // 3. Filter Chips
    qa('.google-chip').forEach(chip => {
      if (chip.id === 'chip-fit-boundary') return;
      chip.addEventListener('click', () => {
        qa('.google-chip').forEach(c => {
          if (c.id !== 'chip-fit-boundary') c.classList.remove('active');
        });
        chip.classList.add('active');
        state.filter = chip.dataset.filter;
        qa('.google-chip[role=tab]').forEach(c => c.setAttribute('aria-selected', String(c === chip)));
        if (state.filter === 'complaint') showComplaintsScreen();
        else renderMarkers();
      });
    });

    // Nút Khớp Toàn cảnh Ranh giới Thảo Nguyên
    const chipFit = q('#chip-fit-boundary');
    if (chipFit) {
      chipFit.addEventListener('click', () => {
        fitThaoNguyenBoundary();
      });
    }

    const btnFit = q('#btn-fit-boundary');
    if (btnFit) {
      btnFit.addEventListener('click', () => {
        fitThaoNguyenBoundary();
      });
    }

    // 4. Ô Tìm kiếm (Searchbox)
    const searchInput = q('#google-search-input');
    const clearBtn = q('#btn-search-clear');

    searchInput.addEventListener('input', () => {
      state.searchQuery = searchInput.value.trim();
      clearBtn.style.display = state.searchQuery ? 'flex' : 'none';
      renderMarkers();
    });

    q('#btn-search-submit').addEventListener('click', showPermitList);
    searchInput.addEventListener('keydown', event => { if(event.key === 'Enter') showPermitList(); });

    clearBtn.addEventListener('click', () => {
      searchInput.value = '';
      state.searchQuery = '';
      clearBtn.style.display = 'none';
      renderMarkers();
    });

    // 5. Đóng thẻ Place Card
    q('#btn-close-place').addEventListener('click', () => {
      q('#google-place-card').style.display = 'none';
      state.selectedPermit = null;
    });

    // 6. Nút Hành động trong Place Card
    q('#act-inspect').addEventListener('click', () => {
      if (!state.selectedPermit) return;
      window.appStartInspection(state.selectedPermit.id || state.selectedPermit.permit_number);
    });

    q('#act-violation').addEventListener('click', showViolationsScreen);

    q('#act-print').addEventListener('click', () => {
      if (!state.selectedPermit) return;
      showPermitA4Modal(state.selectedPermit);
    });

    q('#act-report-site').addEventListener('click', () => {
      showComplaintForm();
    });

    // 7. Thẻ Tọa độ Google
    q('#btn-coord-close').addEventListener('click', () => {
      q('#google-coord-card').style.display = 'none';
    });

    q('#btn-coord-report').addEventListener('click', () => {
      const card = q('#google-coord-card');
      showComplaintForm({ lat: parseFloat(card.dataset.lat), lng: parseFloat(card.dataset.lng) });
    });

    q('#btn-coord-permit').addEventListener('click', () => {
      if (!canApprove()) return;
      const card = q('#google-coord-card');
      const latitude = Number(card.dataset.lat);
      const longitude = Number(card.dataset.lng);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
      card.style.display = 'none';
      showNewPermitForm({ latitude, longitude });
    });

    // 8. Bộ Điều khiển Bản đồ góc phải
    q('#btn-zoom-in').addEventListener('click', () => map && map.zoomIn(0.5));
    q('#btn-zoom-out').addEventListener('click', () => map && map.zoomOut(0.5));
    q('#btn-my-location').addEventListener('click', locateUser);
    q('#btn-measure').addEventListener('click', toggleMeasure);

    // 9. Popup Chuyển Lớp Bản đồ (Layers FAB)
    q('#btn-layer-toggle').addEventListener('click', e => {
      e.stopPropagation();
      const p = q('#google-layers-popup');
      p.style.display = p.style.display === 'none' || !p.style.display ? 'block' : 'none';
    });

    document.addEventListener('click', e => {
      if (!q('#google-layers-popup').contains(e.target) && e.target !== q('#btn-layer-toggle')) {
        q('#google-layers-popup').style.display = 'none';
      }
    });

    qa('.layer-item').forEach(item => {
      item.addEventListener('click', () => {
        const lyr = item.dataset.layer;
        if (tileLayers[lyr] && map) {
          // Gỡ các lớp cũ
          Object.values(tileLayers).forEach(l => map.removeLayer(l));
          // Thêm lớp mới
          tileLayers[lyr].addTo(map);
          tileLayers[lyr].bringToBack();
          qa('.layer-item').forEach(i => i.classList.toggle('active', i === item));
          state.currentLayer = lyr;
          showToast(`Đã chuyển sang lớp: ${lyr === 'satellite' ? 'Vệ tinh Google Hybrid' : lyr === 'roadmap' ? 'Bản đồ Giao thông' : 'Ảnh Esri'}`);
        }
      });
    });

    q('#chk-boundary').addEventListener('change', e => {
      state.showBoundary = e.target.checked;
      renderBoundary();
    });

    q('#chk-complaints').addEventListener('change', e => {
      state.showComplaintPins = e.target.checked;
      renderComplaintPins();
    });

    q('#chk-markers').addEventListener('change', e => {
      state.showMarkers = e.target.checked;
      renderMarkers();
    });

    // 10. Nút Hành động chính Google FAB
    q('#google-main-fab').addEventListener('click', () => {
      if (canInspect()) {
        showTasksScreen();
      } else {
        showComplaintForm();
      }
    });

    // 11. Các nút trong Drawer
    qa('.drawer-item').forEach(item => {
      item.addEventListener('click', () => {
        q('#google-drawer').classList.remove('open');
        q('#google-scrim').classList.remove('active');
        const nav = item.dataset.nav;
        if (nav === 'map') closeSurfaceModal();
        else if (nav === 'list') showPermitList();
        else if (nav === 'tasks') showTasksScreen();
        else if (nav === 'reports') showReportsScreen();
        else if (nav === 'settings') showSettingsScreen();
        else if (nav === 'complaints') showComplaintsScreen();
        else if (nav === 'sendComplaint') showComplaintForm();
        else if (nav === 'myComplaints') showMyComplaintsScreen();
        else if (nav === 'lookup') showLookupForm();
        else if (nav === 'newPermit') showNewPermitForm();
        else if (nav === 'batch') showBatchForm();
        else if (nav === 'violations') showViolationsScreen();
      });
    });

    document.addEventListener('keydown', handleKeyboardShortcuts);

    // 12. Nút đóng Surface Modal
    q('#btn-surface-close').addEventListener('click', closeSurfaceModal);
    q('#btn-surface-back').addEventListener('click', closeSurfaceModal);

    // 13. Thước đo
    q('#btn-measure-close').addEventListener('click', closeMeasure);
    q('#btn-measure-dist').addEventListener('click', () => setMeasureMode('dist'));
    q('#btn-measure-area').addEventListener('click', () => setMeasureMode('area'));
    q('#btn-measure-undo').addEventListener('click', undoMeasurePoint);
    q('#btn-measure-clear').addEventListener('click', clearMeasurePoints);
    q('#btn-measure-save').addEventListener('click', saveCurrentMeasurement);
    q('#btn-measure-save-inspect').addEventListener('click', saveMeasurementToInspection);
    q('#btn-permit-from-parcel').addEventListener('click', showPermitFormFromParcel);

    const btnClearSaved = q('#btn-clear-saved-measures');
    if (btnClearSaved) {
      btnClearSaved.addEventListener('click', () => {
        state.savedMeasurements = [];
        try { localStorage.removeItem('qlttxd_measures'); } catch (e) {}
        renderSavedMeasuresList();
        showToast('Đã xóa toàn bộ nhật ký đo đã lưu');
      });
    }

    // 14. Lắng nghe trạng thái mạng Online / Offline (Milestone C)
    window.addEventListener('online', () => {
      const banner = q('#network-toast');
      banner.style.background = '#15803d';
      q('#network-toast-text').textContent = '✓ ĐÃ CÓ MẠNG TRỞ LẠI: Đang sẵn sàng đồng bộ dữ liệu.';
      banner.classList.add('active');
      setTimeout(() => banner.classList.remove('active'), 5000);
    });

    window.addEventListener('offline', () => {
      const banner = q('#network-toast');
      banner.style.background = '#c2410c';
      q('#network-toast-text').textContent = 'Mất kết nối mạng. Hãy bấm Lưu nháp trên thiết bị trước khi đóng phiếu.';
      banner.classList.add('active');
    });
  }

  // --- EXPORT CÁC HÀM XỬ LÝ TOÀN CỤC CHO CỬA SỔ TRÌNH DUYỆT ---
  window.appCloseModal = closeSurfaceModal;

  function localDate() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  }

  function nullableNumber(selector) {
    const raw = q(selector)?.value?.trim();
    if (raw === '' || raw === undefined) return null;
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error('Số đo phải là số hợp lệ hoặc để trống nếu chưa đo.');
    return value;
  }

  function inspectionPayload(status = 'pending_approval') {
    const active = state.activeInspection;
    if (!active || active.user_id !== state.user?.id) throw new Error('Phiên cán bộ đã thay đổi. Vui lòng đăng nhập lại.');
    return { permit_id:active.permit_id, stage_index:Number(q('#insp-stage').value), inspect_date:q('#insp-date').value,
      measured_area:nullableNumber('#insp-area'), measured_floors:nullableNumber('#insp-floors'),
      measured_setback:nullableNumber('#insp-setback-front'), measured_setback_rear:nullableNumber('#insp-setback-rear'),
      notes:q('#insp-notes').value, photos:active.photos.map(photo=>({...photo})), status };
  }

  function draftFromPayload(payload, active = state.activeInspection) {
    return { ...payload, idempotency_key:active.idempotency_key, user_id:active.user_id, permit_number:active.permit_number, saved_at:new Date().toISOString() };
  }

  async function sendInspection(payload, key) {
    const result = await postJson('/api/internal/inspections', payload, key);
    if (!result.data?.id || result.data.permit_id !== payload.permit_id) throw new Error('Máy chủ chưa xác nhận phiếu đã được lưu. Bản nháp được giữ lại.');
    return result.data;
  }

  function readFileBase64(file) {
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();
      reader.onload=()=>resolve(String(reader.result).split(',')[1]);
      reader.onerror=()=>reject(new Error('Không đọc được ảnh trên thiết bị.'));
      reader.readAsDataURL(file);
    });
  }

  function renderInspectionPhotos() {
    const active=state.activeInspection;
    if(!active)return;
    q('#insp-photo-list').innerHTML=active.photos.map((photo,index)=>`<li>${esc(photo.originalName || photo.fileName)} <button type="button" class="google-btn btn-neutral btn-sm" data-remove-photo="${index}">Bỏ ảnh</button></li>`).join('');
    q('#insp-photo-list').querySelectorAll('[data-remove-photo]').forEach(button=>button.addEventListener('click',()=>{if(active.busy)return;active.photos.splice(Number(button.dataset.removePhoto),1);renderInspectionPhotos();}));
  }

  window.appStartInspection = function (permitId, prefillData = {}) {
    if(!canInspect()) return showLoginForm();
    const p=state.permits.find(item=>item.id===permitId);
    if(!p) return showToast('Không tìm thấy hồ sơ trong phạm vi được phép.');
    const draft=prefillData.draft;
    if(draft && draft.user_id!==state.user.id) return showToast('Bản nháp không thuộc tài khoản này.');
    const stageIdx=draft?.stage_index ?? Math.min(p.done,3);
    const active={ idempotency_key:draft?.idempotency_key || uniqueKey('inspection'),user_id:state.user.id,permit_id:p.id,permit_number:p.permit_number,photos:draft?.photos ? draft.photos.map(photo=>({...photo})) : [],busy:false };
    state.activeInspection=active;
    const numberInput=(id,label,value,step='any')=>`<div><label for="${id}">${label}</label><input type="number" min="0" step="${step}" id="${id}" value="${esc(value ?? '')}" placeholder="Chưa đo"></div>`;
    openSurfaceModal(`Lập phiếu kiểm tra · ${p.permit_number}`, `<form id="form-inspection" class="app-form"><p><strong>${esc(p.permit_number)}</strong> · ${esc(p.site_address)}</p>
      <label for="insp-stage">Mốc kiểm tra</label><select id="insp-stage">${STAGES.map((label,i)=>`<option value="${i}" ${i===stageIdx?'selected':''}>${esc(label)}</option>`).join('')}</select>
      <label for="insp-date">Ngày kiểm tra *</label><input type="date" id="insp-date" value="${esc(draft?.inspect_date || localDate())}" required>
      <p>Để trống số liệu chưa đo. Số đo từ bản đồ chỉ là tham khảo; cần kiểm chứng thực địa.</p>
      <div class="form-grid">${numberInput('insp-floors','Số tầng thực tế',draft?.measured_floors,'1')}${numberInput('insp-area','Diện tích thực tế (m²)',draft?.measured_area)}${numberInput('insp-setback-front','Khoảng lùi trước thực tế (m)',draft?.measured_setback)}${numberInput('insp-setback-rear','Khoảng lùi sau thực tế (m)',draft?.measured_setback_rear)}</div>
      <label for="insp-notes">Ghi chú hiện trường</label><textarea id="insp-notes" rows="4">${esc(draft?.notes || prefillData.measuredNote || '')}</textarea>
      <label for="insp-photos">Ảnh hiện trường (1–5 ảnh khi gửi duyệt; JPEG/PNG, tối đa 3 MB/ảnh)</label><input type="file" id="insp-photos" accept="image/jpeg,image/png" multiple><p id="insp-photo-status" role="status">Ảnh cần có kết nối mạng để tải lên. Nháp trên thiết bị giữ các số đo và ảnh đã tải thành công.</p><ul id="insp-photo-list"></ul>
      <p id="inspection-error" class="form-error" role="alert"></p><div class="form-actions"><button type="button" id="btn-save-local-inspection" class="google-btn btn-neutral">Lưu nháp trên thiết bị</button><button type="button" id="btn-save-server-inspection" class="google-btn btn-neutral">Lưu nháp máy chủ</button><button type="submit" class="google-btn btn-primary">Nộp kết quả kiểm tra</button></div></form>`);
    renderInspectionPhotos();
    q('#insp-photos').addEventListener('change', async event=>{
      const files=Array.from(event.target.files || []);
      if(active.busy)return;
      if(active.photos.length+files.length>5){q('#insp-photo-status').textContent='Tối đa 5 ảnh. Hãy bỏ bớt ảnh trước khi thêm.';event.target.value='';return;}
      active.busy=true;
      try {
        for(const file of files){
          if(!['image/jpeg','image/png'].includes(file.type) || file.size===0 || file.size>3*1024*1024) throw new Error('Chỉ nhận ảnh JPEG/PNG, mỗi ảnh không quá 3 MB.');
          q('#insp-photo-status').textContent=`Đang tải ${file.name}…`;
          const base64=await readFileBase64(file);
          const result=await postJson('/api/internal/files/upload',{base64,fileName:file.name,mimeType:file.type});
          if(state.activeInspection!==active || state.user?.id!==active.user_id) return;
          if(!result.data?.fileName || !result.data.sha256)throw new Error('Máy chủ chưa xác nhận lưu ảnh.');
          active.photos.push({...result.data,originalName:file.name});
          renderInspectionPhotos();
        }
        q('#insp-photo-status').textContent=`Đã tải thành công ${active.photos.length} ảnh.`;
      }catch(error){if(state.activeInspection===active)q('#insp-photo-status').textContent=error.message;}
      finally{active.busy=false;event.target.value='';}
    });
    q('#btn-save-local-inspection').addEventListener('click',()=>window.appSaveOfflineInspection());
    q('#btn-save-server-inspection').addEventListener('click',()=>submitForm('draft'));
    q('#form-inspection').addEventListener('submit',event=>{event.preventDefault();submitForm('pending_approval');});
    async function submitForm(status) {
      if(active.busy)return showToast('Hãy chờ ảnh được tải xong.');
      const form=q('#form-inspection');
      if(!form.reportValidity())return;
      active.busy=true;
      try {
        const payload=inspectionPayload(status);
        if(status==='pending_approval' && (payload.photos.length<1 || payload.photos.length>5))throw new Error('Vui lòng tải từ 1 đến 5 ảnh trước khi gửi duyệt.');
        saveOfflineDraft(draftFromPayload(payload,active));
        q('#inspection-error').textContent='Đang gửi phiếu…';
        await sendInspection(payload,active.idempotency_key);
        if(state.user?.id!==active.user_id)return;
        clearOfflineDraft(active.idempotency_key);
        closeSurfaceModal();state.activeInspection=null;
        await fetchData();
        showToast(status==='draft'?'Đã lưu nháp trên máy chủ.':'Đã nộp phiếu, đang chờ duyệt.');
      }catch(error){if(state.activeInspection===active)q('#inspection-error').textContent=error.message;}
      finally{active.busy=false;}
    }
  };

  window.appSaveOfflineInspection = function () {
    const active=state.activeInspection;
    if(!active || !canInspect())return;
    if(active.busy)return showToast('Hãy chờ ảnh được tải xong trước khi lưu nháp.');
    try {
      const draft=draftFromPayload(inspectionPayload());
      saveOfflineDraft(draft);
      closeSurfaceModal();state.activeInspection=null;
      showToast('Đã lưu các số đo và ảnh đã tải lên vào bản nháp của bạn.');
    }catch(error){q('#inspection-error').textContent=error.message;}
  };

  const syncingDrafts = new Set();
  window.appSyncDraft = async function (idempKey) {
    if(!canInspect() || syncingDrafts.has(idempKey))return;
    const draft=state.offlineDrafts.find(d=>d.idempotency_key===idempKey && d.user_id===state.user.id);
    if(!draft)return;
    if(!Array.isArray(draft.photos) || (draft.status !== 'draft' && draft.photos.length<1) || draft.photos.length>5)return showToast('Mở nháp để bổ sung từ 1 đến 5 ảnh trước khi gửi duyệt.');
    const userId=state.user.id;
    const {permit_id,stage_index,inspect_date,measured_area,measured_setback,measured_setback_rear,measured_floors,notes,photos}=draft;
    syncingDrafts.add(idempKey);
    try {
      await sendInspection({permit_id,stage_index,inspect_date,measured_area,measured_setback,measured_setback_rear,measured_floors,notes,photos,status:draft.status || 'pending_approval'},idempKey);
      if(state.user?.id!==userId)return;
      clearOfflineDraft(idempKey);
      await fetchData();showTasksScreen();showToast('Đã đồng bộ bản nháp thành công.');
    }catch(error){showToast(`${error.message} Bản nháp vẫn được giữ trên thiết bị.`,6000);}
    finally{syncingDrafts.delete(idempKey);}
  };

  window.addEventListener('pageshow', async event => { if(event.persisted) { await restoreSession(); await fetchData(); } });

  window.addEventListener('DOMContentLoaded', async () => {
    setupEventListeners();
    updateAccountUi();
    try {
      const saved=JSON.parse(localStorage.getItem('qlttxd_measures') || '[]');
      if(Array.isArray(saved))state.savedMeasurements=saved;
    }catch{state.savedMeasurements=[];}
    initMap();
    await restoreSession();
    await fetchData();
    const params=new URLSearchParams(window.location.search);
    if((params.get('lookup') || params.get('tra-cuu')))showLookupForm((params.get('lookup') || params.get('tra-cuu')));
    else if(params.get('permit')){
      const p=state.permits.find(item=>item.permit_number===params.get('permit') || item.id===params.get('permit'));
      if(p)selectPermit(p,[p.latitude,p.longitude]);
    }
    if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
  });

})();
