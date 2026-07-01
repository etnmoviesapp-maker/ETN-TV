// ETN TV ULTRA X v24.0 — NEUTRON SERVICE WORKER (ULTRA DATA-SMART)
const CACHE_VER    = 'etntv-v24-offline';
const STATIC_CACHE = 'etntv-static-v24';
const IMG_CACHE    = 'etntv-images-v24';
const CDN_CACHE    = 'etntv-cdn-v24';
const MAX_IMG      = 400;
const MAX_CDN      = 50;
const IMG_TTL_MS   = 7 * 24 * 60 * 60 * 1000; // 7 days

const SHELL_FILES = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png', './404.html'];
const CDN_PRECACHE = [
  'https://cdn.jsdelivr.net/npm/hls.js@1.5.8/dist/hls.min.js',
  'https://www.gstatic.com/firebasejs/9.22.1/firebase-app-compat.js',
  'https://www.gstatic.com/firebasejs/9.22.1/firebase-database-compat.js',
];

self.addEventListener('install', ev => {
  ev.waitUntil(
    Promise.all([
      caches.open(STATIC_CACHE).then(c => c.addAll(SHELL_FILES).catch(() => {})),
      caches.open(CDN_CACHE).then(cache =>
        Promise.allSettled(CDN_PRECACHE.map(url =>
          cache.match(url).then(hit => {
            if (!hit) return fetch(url, {mode:'no-cors'}).then(r=>{if(r)cache.put(url,r);}).catch(()=>{});
          })
        ))
      ),
    ]).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', ev => {
  const KEEP = [STATIC_CACHE, IMG_CACHE, CDN_CACHE];
  ev.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => !KEEP.includes(k)).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isMediaStream(url) {
  const u = url.toLowerCase();
  // v24: Pass ALL HLS/DASH content through natively — SW must not intercept
  if (/\.(m3u8|mpd|ts|aac|vtt|srt)(\?|$)/.test(u)) return true;
  if (/\/seg-\d+\./.test(u) || /\/chunk-\d+\./.test(u)) return true;
  if (u.includes('/manifest') && !u.includes('manifest.json')) return true;
  if (u.includes('googlevideo.com') || u.includes('akamaihd.net') || u.includes('akamai.net')) return true;
  return false;
}

function isLargeMedia(url) {
  const u = url.toLowerCase();
  if (/\.(mp4|mkv|webm|avi|mov|flv|wmv)(\?|$)/.test(u)) return true;
  if (u.includes('dropboxusercontent.com') && /\.(mp4|mkv|webm)/i.test(u)) return true;
  return false;
}

function isFirebase(url) {
  return url.includes('firebaseio.com') || url.includes('firebasestorage.googleapis.com') ||
         (url.includes('googleapis.com') && !url.includes('gstatic.com'));
}

function isYouTube(url) {
  return url.includes('youtube.com') || url.includes('youtu.be') ||
         url.includes('googlevideo.com') || url.includes('ytimg.com');
}

function isCDN(url) {
  return url.includes('cdn.jsdelivr.net') || url.includes('gstatic.com') ||
         url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com') ||
         url.includes('pagead2.googlesyndication.com');
}

function isImageFresh(response) {
  if (!response) return false;
  const date = response.headers.get('date');
  if (!date) return true;
  return (Date.now() - new Date(date).getTime()) < IMG_TTL_MS;
}

async function limitCache(name, max) {
  const c = await caches.open(name);
  const keys = await c.keys();
  if (keys.length > max) {
    await Promise.all(keys.slice(0, keys.length - max).map(k => c.delete(k)));
  }
}

const OFFLINE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3"><rect width="4" height="3" fill="#111"/></svg>';
const OFFLINE_HTML = '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>ETN TV Offline</title><style>body{background:#04040e;color:#fff;font-family:sans-serif;text-align:center;padding:60px 20px;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0}h2{color:#ff2244}button{background:linear-gradient(135deg,#ff2244,#ff6622);color:#fff;border:none;padding:14px 28px;border-radius:24px;font-size:16px;font-weight:800;cursor:pointer;margin-top:20px}</style></head><body><div style="font-size:64px">📺</div><h2>ETN TV ULTRA X v24</h2><p>Internet nahi hai. Connect ho kar dobara try karein.</p><button onclick="location.reload()">🔄 Retry</button></body></html>';

self.addEventListener('fetch', ev => {
  const req = ev.request;
  if (req.method !== 'GET') return;
  const url = req.url;

  // v24 DATA FIX: Never intercept streaming content — let it flow natively
  if (isMediaStream(url)) return;
  if (isLargeMedia(url)) return;
  if (isFirebase(url)) return;
  if (isYouTube(url)) return;

  if (isCDN(url)) {
    ev.respondWith(
      caches.open(CDN_CACHE).then(async cache => {
        const hit = await cache.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req, {mode:'no-cors'});
          if (res) { cache.put(req, res.clone()); limitCache(CDN_CACHE, MAX_CDN); }
          return res;
        } catch { return new Response('', {status:503}); }
      })
    );
    return;
  }

  const urlObj = new URL(url);
  if (req.destination === 'image' || /\.(png|jpg|jpeg|gif|webp|ico|svg|avif)$/i.test(urlObj.pathname)) {
    ev.respondWith(
      caches.open(IMG_CACHE).then(async cache => {
        const hit = await cache.match(req);
        if (hit && isImageFresh(hit)) return hit;
        try {
          const res = await fetch(req, {cache:'no-cache'});
          if (res && res.status === 200) { cache.put(req, res.clone()); limitCache(IMG_CACHE, MAX_IMG); }
          return res;
        } catch {
          if (hit) return hit;
          return new Response(OFFLINE_SVG, {headers:{'Content-Type':'image/svg+xml'}});
        }
      })
    );
    return;
  }

  ev.respondWith(
    fetch(req, {credentials:'same-origin'})
      .then(res => {
        if (res && res.status === 200 && res.type !== 'opaque') {
          caches.open(STATIC_CACHE).then(c => c.put(req, res.clone()));
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        const shell = await caches.match('./index.html') || await caches.match('./');
        if (shell) return shell;
        return new Response(OFFLINE_HTML, {status:200, headers:{'Content-Type':'text/html;charset=utf-8'}});
      })
  );
});

self.addEventListener('message', ev => {
  if (!ev.data) return;
  const { type } = ev.data;
  if (type === 'ETN_PING') { ev.source?.postMessage({type:'ETN_PONG', version:CACHE_VER}); return; }
  if (type === 'SKIP_WAITING') { self.skipWaiting(); return; }
  if (type === 'CLEAR_ALL_CACHES') {
    caches.keys().then(keys => Promise.all(keys.map(k => caches.delete(k)))).then(() => ev.source?.postMessage({type:'CACHES_CLEARED'}));
    return;
  }
  if (type === 'CLEAR_IMG_CACHE') {
    caches.delete(IMG_CACHE).then(() => ev.source?.postMessage({type:'IMG_CACHE_CLEARED'}));
    return;
  }
  if (type === 'WARMUP_CACHE') {
    Promise.all([
      caches.open(STATIC_CACHE).then(cache =>
        Promise.allSettled(SHELL_FILES.map(f => fetch(f).then(r=>{if(r.ok)cache.put(f,r);}).catch(()=>{})))
      ),
      caches.open(CDN_CACHE).then(cache =>
        Promise.allSettled(CDN_PRECACHE.map(url =>
          cache.match(url).then(hit => {
            if (!hit) return fetch(url,{mode:'no-cors'}).then(r=>{if(r)cache.put(url,r);}).catch(()=>{});
          })
        ))
      ),
    ]).then(() => {
      self.clients.matchAll().then(clients => clients.forEach(c => c.postMessage({type:'WARMUP_DONE'})));
    });
    return;
  }
  if (type === 'CACHE_URL' && ev.data.url) {
    caches.open(STATIC_CACHE).then(cache =>
      fetch(ev.data.url).then(r=>{if(r.ok)cache.put(ev.data.url,r);}).catch(()=>{})
    );
    return;
  }
});

self.addEventListener('push', ev => {
  let data = {title:'ETN TV ULTRA X', body:'Naya content available! 🎬'};
  try { data = ev.data?.json() || data; } catch {}
  ev.waitUntil(
    self.registration.showNotification(data.title || 'ETN TV', {
      body: data.body || '', icon: './icon-192.png', badge: './icon-192.png',
      vibrate: [200,100,200,100,200], tag: 'etntv-push', renotify: true,
      data: {url: data.url || './'},
      actions: [{action:'open', title:'📺 Dekho'}, {action:'dismiss', title:'✕ Baad Mein'}],
    })
  );
});

self.addEventListener('notificationclick', ev => {
  ev.notification.close();
  if (ev.action === 'dismiss') return;
  const targetUrl = ev.notification.data?.url || './';
  ev.waitUntil(
    clients.matchAll({type:'window', includeUncontrolled:true}).then(list => {
      const match = list.find(c => c.url.includes(targetUrl));
      if (match) return match.focus();
      return clients.openWindow(targetUrl);
    })
  );
});
