// Offline support for the installed app. Registered by src/pwa.ts in production builds only.
//
// - Pages: network first, falling back to the cached app shell, so a new deploy shows on the next online load.
//   Only navigations to this app's own scope get the shell; anything else on the origin is left alone.
// - Hashed build files under /assets/: cache first; their names change whenever their content does.
// - Icons and the manifest: network first, falling back to the cached copy.
// - The lesson library from the API (GET /lessons and /lessons/<id>): network first, falling back to the last
//   copy, so lessons opened before keep working offline. Nothing else from the API is cached: account, sync
//   and progress requests always go to the network.
// - Everything else (YouTube, the dictionary, other apps on this origin) passes through untouched.
//
// Cache names are prefixed with this registration's scope path, so activate deletes only the caches this copy
// owns — and never a legacy unscoped name it can't prove ownership of.

// The built list of lazy screen chunks (plus their static imports) precached so an unvisited local screen
// still renders offline. Emitting it as an imported script means a chunk change updates the worker itself.
importScripts("./offline-screens.js");

const VERSION = "v1";
const SCOPE = new URL(self.registration.scope);
const PREFIX = `road-to-english:${encodeURIComponent(SCOPE.pathname)}:`;
const SHELL = `${PREFIX}shell-${VERSION}`;
const ASSETS = `${PREFIX}assets-${VERSION}`;
const LESSONS = `${PREFIX}lessons-${VERSION}`;
const API = new URL(new URL(self.location.href).searchParams.get("api") || SCOPE.origin);

// Static public files this app may cache: its built assets, icons and manifest. One allowlist shared by the
// install precache and fetch handling, so nothing else on the origin can enter a cache.
function isStaticFile(url) {
  return url.origin === SCOPE.origin && (url.pathname.startsWith(`${SCOPE.pathname}assets/`) || url.pathname.startsWith(`${SCOPE.pathname}icons/`) || url.pathname === `${SCOPE.pathname}manifest.webmanifest`);
}

// The app shell and the allowlisted files it loads first, read from the built index.html.
async function precache() {
  const shell = await caches.open(SHELL);
  const response = await fetch(SCOPE.href, { cache: "no-cache" });
  if (!storable(response)) return;
  await shell.put(SCOPE.href, response.clone());
  const html = await response.text();
  const files = new Set(
    [
      ...[...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((match) => new URL(match[1], SCOPE)),
      ...self.RTE_OFFLINE_SCREENS.map((name) => new URL(name, SCOPE)),
    ]
      .filter(isStaticFile)
      .map((url) => url.href),
  );
  const assets = await caches.open(ASSETS);
  await Promise.all(
    Array.from(files, async (href) => {
      try {
        const file = await fetch(href);
        if (storable(file)) await assets.put(href, file);
      } catch {
        // A file that cannot be fetched or stored is simply absent from the cache.
      }
    }),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  const keep = new Set([SHELL, ASSETS, LESSONS]);
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names.filter((name) => name.startsWith(PREFIX) && !keep.has(name)).map((name) => caches.delete(name)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// Responses come back by URL: everything stored is a public representation, so lookups ignore Vary.
const MATCH = { ignoreVary: true };

// Only a public representation may enter a cache: a 200 that was not redirected, does not forbid storage,
// and carries no Vary a request here could answer differently (Origin and Accept-Encoding are safe here).
function storable(response) {
  const cc = (response.headers.get("Cache-Control") || "")
    .toLowerCase()
    .split(",")
    .map((v) => v.trim().split("=")[0]);
  const vary = (response.headers.get("Vary") || "")
    .toLowerCase()
    .split(",")
    .map((v) => v.trim());
  return (
    response.status === 200 &&
    !response.redirected &&
    !cc.includes("no-store") &&
    !cc.includes("private") &&
    vary.every((h) => !h || h === "origin" || h === "accept-encoding")
  );
}

// Keep the fetched response even when storing it fails (quota): cache writes are best effort.
async function putSafe(cache, key, response) {
  try {
    await cache.put(key, response);
  } catch {
    // A failed store never replaces the real response.
  }
}

async function networkFirst(request, cacheName, fallbackKey) {
  const cache = await caches.open(cacheName).catch(() => null);
  if (!cache) return fetch(request);
  let response;
  try {
    response = await fetch(request);
  } catch (error) {
    const cached = await cache.match(fallbackKey ?? request, MATCH);
    if (cached) return cached;
    throw error;
  }
  if (storable(response)) await putSafe(cache, fallbackKey ?? request, response.clone());
  return response;
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName).catch(() => null);
  if (!cache) return fetch(request);
  const cached = await cache.match(request, MATCH).catch(() => undefined);
  if (cached) return cached;
  const response = await fetch(request);
  if (storable(response)) await putSafe(cache, request, response.clone());
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

  if (
    request.mode === "navigate" &&
    url.origin === SCOPE.origin &&
    (url.pathname === SCOPE.pathname || url.pathname === `${SCOPE.pathname}index.html`) &&
    !url.search
  ) {
    // Every page is the same app shell (the app routes by hash).
    event.respondWith(networkFirst(request, SHELL, SCOPE.href));
  } else if (isStaticFile(url)) {
    if (url.pathname.startsWith(`${SCOPE.pathname}assets/`)) {
      event.respondWith(cacheFirst(request, ASSETS));
    } else {
      event.respondWith(networkFirst(request, ASSETS));
    }
  } else if (isLessonRequest(url)) {
    event.respondWith(networkFirst(request, LESSONS));
  }
});

// A page that loaded before this worker controlled it replays the public requests it already made, so an
// offline reload of that first visit finds them cached. Only this scope's own client may ask, and only
// plain hashed-asset or public lesson URLs are fetched and stored under the same rules as live traffic.
self.addEventListener("message", (event) => {
  if (event.data?.type !== "warm-first-visit" || !Array.isArray(event.data.urls)) return;
  const sender = event.source?.url;
  if (typeof sender !== "string" || !URL.canParse(sender)) return;
  const from = new URL(sender);
  if (from.origin !== SCOPE.origin || (from.pathname !== SCOPE.pathname && from.pathname !== `${SCOPE.pathname}index.html`)) return;
  event.waitUntil(
    Promise.all(
      event.data.urls.map(async (name) => {
        if (typeof name !== "string" || !URL.canParse(name)) return;
        const url = new URL(name);
        if (url.search || url.hash || url.username || url.password) return;
        const cache =
          isStaticFile(url) && url.pathname.startsWith(`${SCOPE.pathname}assets/`) ? ASSETS : isLessonRequest(url) ? LESSONS : null;
        if (cache) await cacheFirst(new Request(url.href, { credentials: "omit", redirect: "error" }), cache).catch(() => undefined);
      }),
    ),
  );
});
