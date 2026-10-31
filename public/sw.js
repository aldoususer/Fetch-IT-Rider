// Fetch-It service worker — minimal app-shell caching for installability.
// Intentionally network-first for HTML and stale-while-revalidate for static
// assets, so the user always gets fresh content when online but can still
// load the app shell offline.

const CACHE_VERSION = "fetchit-rider-background-v5";
const APP_SHELL = [
  "/",
  "/manifest.webmanifest",
  "/rider-logo.png",
  "/rider-icon-192.png",
  "/rider-icon-512.png",
  "/rider-favicon-32.png",
  "/rider-apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  // Only handle GETs.
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // Network-first for HTML / navigations so users always see fresh UI.
  if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match("/")))
    );
    return;
  }

  // Bypass for API calls & WebSocket upgrades — never cache these.
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/socket.io/")) {
    return;
  }

  // Stale-while-revalidate for static assets.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, copy)).catch(() => {});
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});

// Allow page to trigger skipWaiting via postMessage.
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});


// The worker can run with every page closed. Persist the active account only;
// never store cookies, credentials, customer addresses or notification content.
function riderPushAccount(write, riderId) {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('fetchit-rider-push-state', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('settings');
    request.onerror = () => reject(new Error('Notification state unavailable'));
    request.onsuccess = () => {
      const db = request.result, tx = db.transaction('settings', write ? 'readwrite' : 'readonly');
      const store = tx.objectStore('settings'), operation = write ? store.put(riderId, 'rider') : store.get('rider');
      tx.oncomplete = () => { db.close(); resolve(write ? riderId : operation.result ?? null); };
      tx.onabort = tx.onerror = () => { db.close(); reject(new Error('Notification state unavailable')); };
    };
  });
}
let riderAccountWrite = Promise.resolve();
self.addEventListener('message', event => {
  if (event.data?.type !== 'RIDER_PUSH_ACCOUNT') return;
  const id = event.data.riderId;
  if (id !== null && (typeof id !== 'string' || id.length > 100)) return;
  try { if (!event.source?.url || new URL(event.source.url).origin !== self.location.origin) return; } catch { return; }
  riderAccountWrite = riderAccountWrite.catch(() => {}).then(() => riderPushAccount(true, id));
  event.waitUntil(riderAccountWrite.then(async () => {
    if (id === null) for (const notification of await self.registration.getNotifications()) notification.close();
    event.ports?.[0]?.postMessage({ok:true});
  }).catch(() => event.ports?.[0]?.postMessage({ok:false})));
});
function safeRiderPushUrl(value) {
  try { const url = new URL(value, self.location.origin); return url.origin === self.location.origin && url.pathname === '/' ? url : null; } catch { return null; }
}
self.addEventListener('push', event => {
  event.waitUntil((async () => {
    let data; try { data = event.data?.json(); } catch { return; }
    if (!data || data.recipientRole !== 'RIDER' || !['RIDE','DELIVERY'].includes(data.category) ||
        typeof data.id !== 'string' || data.id.length > 100 || typeof data.customerId !== 'string' ||
        typeof data.title !== 'string' || data.title.length > 160 || !safeRiderPushUrl(data.url)) return;
    await riderAccountWrite;
    if (await riderPushAccount(false) !== data.customerId) return;
    await self.registration.showNotification(data.title, { body: typeof data.body === 'string' ? data.body.slice(0,500) : 'Open Fetch-It Rider to view this update.',
      icon:'/rider-icon-192.png', badge:'/rider-favicon-32.png', tag:data.id,
      data:{riderId:data.customerId, bookingId:safeRiderPushUrl(data.url).searchParams.get('job')} });
    for (const client of await self.clients.matchAll({type:'window',includeUncontrolled:true})) {
      if (new URL(client.url).origin === self.location.origin) client.postMessage({type:'FETCHIT_RIDER_PUSH',riderId:data.customerId});
    }
  })());
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    await riderAccountWrite;
    const owner = await riderPushAccount(false), data = event.notification.data;
    const id = owner && owner === data?.riderId && typeof data.bookingId === 'string' && data.bookingId.length <= 100 ? data.bookingId : null;
    const target = new URL('/',self.location.origin); if (id) target.searchParams.set('job',id);
    const windows = await self.clients.matchAll({type:'window',includeUncontrolled:true});
    const current = windows.find(client => new URL(client.url).origin === self.location.origin);
    if (current) { if (id) current.postMessage({type:'RIDER_NOTIFICATION',bookingId:id}); return current.focus(); }
    return self.clients.openWindow(target.href);
  })());
});
