// FreeZone BD - offline helper (service worker).
// It keeps a copy of what the app loads, so the app opens without internet:
//  - the app's own files: the internet first, the copy when offline; the Firebase code (www.gstatic.com): the copy first
//  - pictures of posts and avatars: kept for next time (the newest 200)
// It never touches the database, login or uploads: those always use the real internet.
const VERSION = "fz-offline-v1";
const CODE = VERSION + "-code";
const PICS = VERSION + "-pics";
const CODE_HOSTS = ["www.gstatic.com", "cdn.tailwindcss.com", "fonts.googleapis.com", "fonts.gstatic.com", "cdnjs.cloudflare.com", "cdn.jsdelivr.net"];
const PIC_HOSTS = ["i.ibb.co", "res.cloudinary.com"];
const MAX_PICS = 200;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

// copy first, and refresh the copy from the internet in the background
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const fresh = fetch(request).then((response) => {
    if (response && (response.ok || response.type === "opaque")) cache.put(request, response.clone()).catch(() => {});
    return response;
  });
  if (hit) { fresh.catch(() => {}); return hit; }
  return fresh;
}

// pages: the internet first (so updates arrive), the copy when there is no internet
async function networkFirst(request) {
  const cache = await caches.open(CODE);
  try {
    const response = await fetch(request);
    if (response && response.ok) cache.put(request, response.clone()).catch(() => {});
    return response;
  } catch (error) {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || request.headers.has("range")) return; // videos and uploads are not touched
  let url;
  try { url = new URL(request.url); } catch (error) { return; }
  if (url.protocol !== "https:" && url.protocol !== "http:") return;

  if (request.mode === "navigate" && url.origin === self.location.origin) {
    event.respondWith(networkFirst(request));
    return;
  }
  // the app's own files: the internet first (an update shows at once), the copy when there is no internet
  if (url.origin === self.location.origin && !/\.(mp4|webm|mov)$/i.test(url.pathname)) {
    event.respondWith(networkFirst(request));
    return;
  }
  // Firebase code and fonts have a version in their address, so the copy is safe to use first
  if (CODE_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request, CODE));
    return;
  }
  if (PIC_HOSTS.includes(url.hostname) && request.destination === "image") {
    event.respondWith(staleWhileRevalidate(request, PICS).finally(() => trim(PICS, MAX_PICS)));
  }
});
