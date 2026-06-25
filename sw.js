// ETN TV ULTRA X v23.0 — NEUTRON SERVICE WORKER (OFFLINE + DATA-SMART)
// ══════════════════════════════════════════════════════════════════════════════
// v23 New: IndexedDB Offline System support | WARMUP_CACHE | Smart fallbacks
// ══════════════════════════════════════════════════════════════════════════════
const CACHE_VER    = 'etntv-v23-offline';
const STATIC_CACHE = 'etntv-static-v23';
const IMG_CACHE    = 'etntv-images-v23';
const CDN_CACHE    = 'etntv-cdn-v23';
const MAX_IMG      = 600;
const MAX_CDN      = 50;

// App shell files to always cache
const SHELL_FILES = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './404.html',
];

// CDN scripts worth caching for offline
const CDN_PRECACHE = [
  'https://cdn.jsdelivr.net/npm/hls.js@1.5.8/dist/hls.min.js',
  'https://www.gstatic.com/firebasejs/9.22.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/9.22.1/firebase-database-compat.js',
];

// ── INSTALL: App shell + CDN scripts cache ────────────────────────────────────
self.addEventListener('install', ev => {
  ev.waitUntil(
    Promise.all([
      // Cache app shell
      caches.open(STATIC_CACHE).then(c =>
        c.addAll(SHELL_FILES).catch(() => {})
      ),
      // Cache CDN scripts (best effort — offline ke liye)
      caches.open(CDN_CACHE).then(cache =>
        Promise.allSettled(
          CDN_PRECACHE.map(url =>
            cache.match(url).then(hit => {
              if (!hit) return fetch(url, { mode: 'no-cors' }).then(r => { if (r) cache.put(url, r); }).catch(() => {});
            })
          )
        )
      ),
    ]).then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: Purane caches delete ────────────────────────────────────────────
self.addEventListener('activate', ev => {
  const KEEP = [STATIC_CACHE, IMG_CACHE, CDN_CACHE];
  ev.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !KEEP.includes(k)).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── HELPERS ───────────────────────────────────────────────────────────────────
function isMediaStream(url) {
  const u = url.toLowerCase();
  if (/\.(m3u8|mpd|ts)(\?|$)/.test(u)) return true;
  if (u.includes('/manifest') && !u.includes('manifest.json')) return true;
  if (u.includes('googlevideo.com')) return true;
  return false;
}

function isLargeMediaFile(url) {
  const u = url.toLowerCase();
  // Large files — let browser handle with native range requests
  if (/\.(mp4|mkv|webm|avi|mov|flv|wmv)(\?|$)/.test(u)) return true;
  if (u.includes('dropboxusercontent.com') && /\.(mp4|mkv|webm)/i.test(u)) return true;
  return false;
}

function isFirebase(url) {
  return url.includes('firebaseio.com') ||
         url.includes('firebasestorage.googleapis.com') ||
         (url.includes('googleapis.com') && !url.includes('gstatic.com'));
}

function isYouTube(url) {
  return url.includes('youtube.com') ||
         url.includes('youtu.be') ||
         url.includes('googlevideo.com') ||
         url.includes('ytimg.com');
}

function isCDN(url) {
  return url.includes('cdn.jsdelivr.net') ||
         url.includes('gstatic.com') ||
         url.includes('fonts.googleapis.com') ||
         url.includes('fonts.gstatic.com') ||
         url.includes('pagead2.googlesyndication.com');
}

async function limitCache(name, max) {
  const c    = await caches.open(name);
  const keys = await c.keys();
  if (keys.length > max) {
    await Promise.all(keys.slice(0, keys.length - max).map(k => c.delete(k)));
  }
}

// ── FETCH ENGINE ──────────────────────────────────────────────────────────────
self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET') return;

  const url = req.url;

  // ❌ HLS/DASH streams → always network (SW se handle nahi hoga)
  if (isMediaStream(url)) return;

  // ❌ Large video files → browser native range requests
  if (isLargeMediaFile(url)) return;

  // ❌ Firebase real-time DB → always fresh
  if (isFirebase(url)) return;

  // ❌ YouTube → unka CDN handle kare
  if (isYouTube(url)) return;

  // ── CDN scripts: Cache-first ─────────────────────────────────────────────
  if (isCDN(url)) {
    ev.respondWith(
      caches.open(CDN_CACHE).then(async cache => {
        const hit = await cache.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req, { mode: 'no-cors' });
          if (res) {
            cache.put(req, res.clone());
            limitCache(CDN_CACHE, MAX_CDN);
          }
          return res;
        } catch {
          return new Response('', { status: 503, statusText: 'CDN Offline' });
        }
      })
    );
    return;
  }

  // ── Images: Cache-first with 600 limit ──────────────────────────────────
  const urlObj = new URL(url);
  if (req.destination === 'image' ||
      /\.(png|jpg|jpeg|gif|webp|ico|svg|avif)$/i.test(urlObj.pathname)) {
    ev.respondWith(
      caches.open(IMG_CACHE).then(async cache => {
        const hit = await cache.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          if (res && res.status === 200) {
            cache.put(req, res.clone());
            limitCache(IMG_CACHE, MAX_IMG);
          }
          return res;
        } catch {
          // Offline placeholder
          return new Response(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect fill="#1a1a2e"/></svg>',
            { headers: { 'Content-Type': 'image/svg+xml' } }
          );
        }
      })
    );
    return;
  }

  // ── App shell (HTML/CSS/JS): Network-first, cache fallback ───────────────
  ev.respondWith(
    fetch(req, { credentials: 'same-origin' })
      .then(res => {
        // Cache successful responses
        if (res && res.status === 200 && res.type !== 'opaque') {
          caches.open(STATIC_CACHE).then(c => c.put(req, res.clone()));
        }
        return res;
      })
      .catch(async () => {
        // Offline — check cache
        const cached = await caches.match(req);
        if (cached) return cached;

        // SPA fallback — index.html de do (GitHub Pages + PWA)
        const shell = await caches.match('./index.html') ||
                      await caches.match('./');
        if (shell) return shell;

        // Last resort offline page
        return new Response(
          `<!DOCTYPE html><html><head><meta charset="utf-8">
          <meta name="viewport" content="width=device-width,initial-scale=1">
          <title>ETN TV — Offline</title>
          <style>
            body{background:#04040e;color:#fff;font-family:sans-serif;text-align:center;
                 padding:60px 20px;margin:0;min-height:100vh;display:flex;
                 flex-direction:column;align-items:center;justify-content:center}
            h2{color:#ff2244;font-size:28px;margin-bottom:8px}
            p{color:rgba(255,255,255,.6);font-size:14px;line-height:1.7;max-width:320px}
            .icon{font-size:64px;margin-bottom:16px}
            button{background:linear-gradient(135deg,#ff2244,#ff6622);color:#fff;border:none;
                   padding:14px 28px;border-radius:24px;font-size:16px;font-weight:800;
                   cursor:pointer;margin-top:20px;font-family:inherit}
          </style></head><body>
          <div class="icon">📺</div>
          <h2>ETN TV ULTRA X</h2>
          <p>Internet nahi hai aur app abhi cache nahi tha.<br><br>
             Internet se connect ho kar app khulein — phir offline bhi kaam karega.</p>
          <button onclick="location.reload()">🔄 Dobara Try Karein</button>
          </body></html>`,
          { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      })
  );
});

// ── MESSAGING ──────────────────────────────────────────────────────────────────
self.addEventListener('message', ev => {
  if (!ev.data) return;
  const { type } = ev.data;

  // Health check
  if (type === 'ETN_PING') {
    ev.source?.postMessage({ type: 'ETN_PONG', version: CACHE_VER });
    return;
  }

  // Force activate new SW
  if (type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  // Clear all caches
  if (type === 'CLEAR_ALL_CACHES') {
    caches.keys()
      .then(keys => Promise.all(keys.map(k => caches.delete(k))))
      .then(() => ev.source?.postMessage({ type: 'CACHES_CLEARED' }));
    return;
  }

  // ── WARMUP CACHE: App boot pe call hota hai ────────────────────────────
  // Shell + CDN scripts cache kar lo — next time instant load
  if (type === 'WARMUP_CACHE') {
    Promise.all([
      // App shell refresh
      caches.open(STATIC_CACHE).then(cache =>
        Promise.allSettled(
          SHELL_FILES.map(f => fetch(f).then(r => { if (r.ok) cache.put(f, r); }).catch(() => {}))
        )
      ),
      // CDN scripts (HLS.js + Firebase)
      caches.open(CDN_CACHE).then(cache =>
        Promise.allSettled(
          CDN_PRECACHE.map(url =>
            cache.match(url).then(hit => {
              if (!hit) {
                return fetch(url, { mode: 'no-cors' })
                  .then(r => { if (r) cache.put(url, r); })
                  .catch(() => {});
              }
            })
          )
        )
      ),
    ]).then(() => {
      // Notify client that warmup is done
      self.clients.matchAll().then(clients => {
        clients.forEach(c => c.postMessage({ type: 'WARMUP_DONE' }));
      });
    });
    return;
  }

  // Cache specific URL (for manual pre-caching)
  if (type === 'CACHE_URL' && ev.data.url) {
    caches.open(STATIC_CACHE).then(cache =>
      fetch(ev.data.url).then(r => { if (r.ok) cache.put(ev.data.url, r); }).catch(() => {})
    );
    return;
  }
});

// ── PUSH NOTIFICATIONS ──────────────────────────────────────────────────────
self.addEventListener('push', ev => {
  let data = { title: 'ETN TV ULTRA X', body: 'Naya content available! 🎬' };
  try { data = ev.data?.json() || data; } catch {}
  ev.waitUntil(
    self.registration.showNotification(data.title || 'ETN TV', {
      body:     data.body || '',
      icon:     './icon-192.png',
      badge:    './icon-192.png',
      vibrate:  [200, 100, 200, 100, 200],
      tag:      'etntv-push',
      renotify: true,
      data:     { url: data.url || './' },
      actions:  [
        { action: 'open',   title: '📺 Dekho'  },
        { action: 'dismiss', title: '✕ Baad Mein' },
      ],
    })
  );
});

self.addEventListener('notificationclick', ev => {
  ev.notification.close();
  if (ev.action === 'dismiss') return;
  const targetUrl = ev.notification.data?.url || './';
  ev.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      const match = list.find(c => c.url.includes(targetUrl));
      if (match) return match.focus();
      return clients.openWindow(targetUrl);
    })
  );
});
