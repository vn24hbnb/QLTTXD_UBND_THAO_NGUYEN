/* Chỉ lưu giao diện; hồ sơ, ảnh và bản in nghiệp vụ luôn yêu cầu máy chủ. */
const CACHE_NAME = 'qlttxd-shell-v3';
const STATIC_ASSETS = ['/', '/index.html', '/style.css', '/app.js', '/manifest.json', '/icon.svg'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('qlttxd-') && key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET' || !STATIC_ASSETS.includes(url.pathname) || url.search) return;
  event.respondWith(fetch(event.request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)));
    }
    return response;
  }).catch(async () => (await caches.match(event.request)) || new Response('Thiết bị đang mất kết nối. Vui lòng thử lại khi có mạng.', {status: 503, headers: {'Content-Type': 'text/plain; charset=utf-8'}})));
});
