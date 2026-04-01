// ═══════════════════════════════════════
//  TRADER OS · sw.js  (Service Worker)
//  Cache-first PWA · offline support
//  Versão: 4.0
// ═══════════════════════════════════════

const CACHE_NAME  = 'trader-os-v4';
const CACHE_URLS  = [
  '/',
  '/index.html',
  '/manifest.json',
];

const NEVER_CACHE = [
  'supabase.co',
  'stripe.com',
  'anthropic.com',
];

// ── Install ───────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => Promise.allSettled(
        CACHE_URLS.map(url => cache.add(url).catch(e => console.warn('[SW] skip:', url, e)))
      ))
      .then(() => self.skipWaiting())
  );
});

// ── Activate ──────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// ── Fetch ─────────────────────────────
self.addEventListener('fetch', event => {
  const url = event.request.url;
  if (event.request.method !== 'GET') return;
  if (NEVER_CACHE.some(d => url.includes(d))) return;

  // CDN: cache on first fetch
  const isCDN = url.includes('cdnjs.') || url.includes('cdn.jsdelivr') ||
                url.includes('fonts.gstatic') || url.includes('fonts.googleapis');
  if (isCDN) {
    event.respondWith(
      caches.match(event.request).then(cached => cached ||
        fetch(event.request).then(res => {
          if (res.ok) caches.open(CACHE_NAME).then(c => c.put(event.request, res.clone()));
          return res;
        })
      )
    );
    return;
  }

  // HTML: network-first, fallback to cache
  if (event.request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          if (res.ok) caches.open(CACHE_NAME).then(c => c.put(event.request, res.clone()));
          return res;
        })
        .catch(() => caches.match('/index.html'))
    );
    return;
  }

  // All else: cache-first
  event.respondWith(
    caches.match(event.request).then(cached => cached ||
      fetch(event.request).then(res => {
        if (res.ok) caches.open(CACHE_NAME).then(c => c.put(event.request, res.clone()));
        return res;
      })
    )
  );
});

// ── Push Notifications ────────────────
self.addEventListener('push', event => {
  const data = event.data?.json() || {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'Trader OS', {
      body:               data.body || '',
      icon:               '/assets/icon-192.png',
      badge:              '/assets/icon-72.png',
      tag:                data.tag  || 'trader-os',
      requireInteraction: data.urgent || false,
      vibrate: data.urgent ? [200,100,200] : [100],
      actions: data.urgent ? [
        { action:'open', title:'Abrir app' },
        { action:'dismiss', title:'Dispensar' },
      ] : [],
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  event.waitUntil(
    clients.matchAll({ type:'window', includeUncontrolled:true }).then(list => {
      const w = list.find(c => c.url.includes(self.location.origin));
      return w ? w.focus() : clients.openWindow('/');
    })
  );
});

// ── Background Sync ───────────────────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-trades') event.waitUntil(syncPendingTrades());
});

async function syncPendingTrades() {
  try {
    const idb = await openIDB();
    const pending = await getAllFromStore(idb, 'pending-trades');
    for (const trade of pending) {
      try {
        const res = await fetch('/api/trades', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(trade) });
        if (res.ok) await deleteFromStore(idb, 'pending-trades', trade.id);
      } catch { break; }
    }
  } catch(e) { console.warn('[SW] Sync failed:', e); }
}

function openIDB() {
  return new Promise((res,rej) => {
    const r = indexedDB.open('trader-os-sync', 1);
    r.onupgradeneeded = e => e.target.result.createObjectStore('pending-trades', { keyPath:'id' });
    r.onsuccess = e => res(e.target.result);
    r.onerror   = e => rej(e.target.error);
  });
}
function getAllFromStore(db, store) {
  return new Promise((res,rej) => { const r = db.transaction(store).objectStore(store).getAll(); r.onsuccess=()=>res(r.result); r.onerror=()=>rej(r.error); });
}
function deleteFromStore(db, store, id) {
  return new Promise((res,rej) => { const r = db.transaction(store,'readwrite').objectStore(store).delete(id); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); });
}
