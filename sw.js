// ═══════════════════════════════════════
//  TRADER OS · sw.js  (Service Worker)
//  PWA offline + cache + push notifications
//  Coloque este arquivo na raiz do projeto
// ═══════════════════════════════════════

const CACHE_NAME = 'trader-os-v3.1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/css/design-system.css',
  '/css/layout.css',
  '/css/components.css',
  '/css/pages.css',
  '/js/app.js',
  '/js/db.js',
  '/js/cloud.js',
  '/js/config.js',
  '/js/validation.js',
  '/js/propfirm.js',
  '/js/import.js',
  '/manifest.json',
];

const CACHE_SKIP = [
  'supabase.co',
  'stripe.com',
  'anthropic.com',
  'googleapis.com',
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
];

// ── Install ───────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── Activate ──────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch (cache first para assets, network first para API) ──
self.addEventListener('fetch', event => {
  const url = event.request.url;

  // Nunca cacheia chamadas de API externas
  if (CACHE_SKIP.some(domain => url.includes(domain))) return;
  if (event.request.method !== 'GET') return;

  // Para páginas HTML: network first (garante versão atualizada)
  if (event.request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(event.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
          return res;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // Para assets (CSS, JS, imagens): cache first
  event.respondWith(
    caches.match(event.request).then(cached => {
      if (cached) return cached;
      return fetch(event.request).then(res => {
        if (res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then(c => c.put(event.request, clone));
        }
        return res;
      });
    })
  );
});

// ── Push Notifications ────────────────
self.addEventListener('push', event => {
  const data = event.data?.json() || {};
  event.waitUntil(
    self.registration.showNotification(data.title || 'Trader OS', {
      body:               data.body   || '',
      icon:               '/assets/icon-192.png',
      badge:              '/assets/icon-72.png',
      tag:                data.tag    || 'trader-os',
      requireInteraction: data.urgent || false,
      data:               data,
      actions: data.urgent ? [
        { action: 'open', title: 'Abrir app' },
        { action: 'dismiss', title: 'Dispensar' },
      ] : [],
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  if (event.action === 'dismiss') return;
  event.waitUntil(
    clients.matchAll({ type: 'window' }).then(clientList => {
      for (const client of clientList) {
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          return client.focus();
        }
      }
      return clients.openWindow('/');
    })
  );
});

// ── Background Sync (para offline) ────
self.addEventListener('sync', event => {
  if (event.tag === 'sync-trades') {
    event.waitUntil(syncPendingTrades());
  }
});

async function syncPendingTrades() {
  // Recupera trades pendentes do IndexedDB e envia ao Supabase
  // Implementação simplificada — expanda conforme necessário
  const db = await openIDB();
  const pending = await getAllFromStore(db, 'pending-trades');
  for (const trade of pending) {
    try {
      await fetch('/api/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(trade),
      });
      await deleteFromStore(db, 'pending-trades', trade.id);
    } catch { break; }
  }
}

// IndexedDB helpers simples
function openIDB() {
  return new Promise((res, rej) => {
    const req = indexedDB.open('trader-os-sync', 1);
    req.onupgradeneeded = e => {
      e.target.result.createObjectStore('pending-trades', { keyPath: 'id' });
    };
    req.onsuccess = e => res(e.target.result);
    req.onerror   = e => rej(e.target.error);
  });
}

function getAllFromStore(db, store) {
  return new Promise((res, rej) => {
    const req = db.transaction(store).objectStore(store).getAll();
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

function deleteFromStore(db, store, id) {
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readwrite').objectStore(store).delete(id);
    req.onsuccess = () => res();
    req.onerror   = () => rej(req.error);
  });
}
