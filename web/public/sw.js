// Offline support for the installed app. Registered by src/pwa.ts in production builds only.
//
// - Pages: network first, falling back to the cached app shell, so a new deploy shows on the next online load.
// - Hashed build files under /assets/: cache first; their names change whenever their content does.
// - The lesson library from the API (GET /lessons and /lessons/<id>): network first, falling back to the last
//   copy, so lessons opened before keep working offline. Nothing else from the API is cached: account, sync
//   and progress requests always go to the network.
// - Everything else (YouTube, the dictionary) passes through untouched.

const VERSION = "v1";
const SHELL = `shell-${VERSION}`;
const ASSETS = `assets-${VERSION}`;
const LESSONS = `lessons-${VERSION}`;
const SCOPE = new URL(self.registration.scope);
const API = new URL(new URL(self.location.href).searchParams.get("api") || SCOPE.origin);

// The app shell and the files it loads first, read from the built index.html.
async function precache() {
  const shell = await caches.open(SHELL);
  const response = await fetch(SCOPE.href, { cache: "no-cache" });
  if (!response.ok) return;
  await shell.put(SCOPE.href, response.clone());
  const html = await response.text();
  const files = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((match) => new URL(match[1], SCOPE))
    .filter((url) => url.origin === SCOPE.origin && url.pathname !== SCOPE.pathname);
  const assets = await caches.open(ASSETS);
  await Promise.all(files.map((url) => assets.add(url.href).catch(() => undefined)));
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  const keep = new Set([SHELL, ASSETS, LESSONS]);
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => !keep.has(name)).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

async function networkFirst(request, cacheName, fallbackKey) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(fallbackKey ?? request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(fallbackKey ?? request);
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  return response;
}

function isLessonRequest(url) {
  const base = API.pathname.replace(/\/$/, "");
  return url.origin === API.origin && /^\/lessons(\/[^/]+)?$/.test(url.pathname.slice(base.length)) && url.pathname.startsWith(base);
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  if (request.mode === "navigate" && url.origin === SCOPE.origin) {
    // Every page is the same app shell (the app routes by hash).
    event.respondWith(networkFirst(request, SHELL, SCOPE.href));
  } else if (url.origin === SCOPE.origin && url.pathname.startsWith(`${SCOPE.pathname}assets/`)) {
    event.respondWith(cacheFirst(request, ASSETS));
  } else if (isLessonRequest(url)) {
    event.respondWith(networkFirst(request, LESSONS));
  } else if (url.origin === SCOPE.origin) {
    event.respondWith(networkFirst(request, SHELL));
  }
});
