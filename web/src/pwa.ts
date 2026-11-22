// Registers the service worker that lets the installed app open offline (public/sw.js). Development builds
// skip it, so Vite's hot reload and the e2e suite always see fresh files.
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  const api = new URL(import.meta.env.VITE_API_URL || window.location.origin, window.location.href).href;
  const url = `${import.meta.env.BASE_URL}sw.js?api=${encodeURIComponent(api)}`;
  const sw = navigator.serviceWorker;
  // A cold first visit (e.g. a deep link) loads resources while the worker installs; once it takes
  // control, replay what this page already requested so an offline reload finds them cached.
  if (!sw.controller && typeof PerformanceObserver !== "undefined" && PerformanceObserver.supportedEntryTypes.includes("resource")) {
    sw.addEventListener(
      "controllerchange",
      () => {
        const worker = sw.controller;
        if (!worker) return;
        const claimedAt = performance.now();
        const origins = new Set([location.origin, new URL(api).origin]);
        const seen = new Set<string>();
        const observer = new PerformanceObserver((list) => {
          const urls: string[] = [];
          for (const e of list.getEntries()) {
            if (e.startTime >= claimedAt || seen.has(e.name)) continue;
            const u = new URL(e.name, location.href);
            if (!origins.has(u.origin) || u.search || u.hash) continue;
            seen.add(e.name);
            urls.push(u.href);
          }
          if (urls.length) worker.postMessage({ type: "warm-first-visit", urls });
        });
        observer.observe({ type: "resource", buffered: true });
        window.addEventListener("pagehide", () => observer.disconnect(), { once: true });
      },
      { once: true },
    );
  }
  window.addEventListener("load", () => {
    // The worker imports the screen list it precaches: never let an HTTP cache hold a stale copy.
    navigator.serviceWorker.register(url, { updateViaCache: "none" }).catch(() => undefined);
  });
}
