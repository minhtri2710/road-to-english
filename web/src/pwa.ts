// Registers the service worker that lets the installed app open offline (public/sw.js). Development builds
// skip it, so Vite's hot reload and the e2e suite always see fresh files.
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  const api = new URL(import.meta.env.VITE_API_URL || window.location.origin, window.location.href).href;
  const url = `${import.meta.env.BASE_URL}sw.js?api=${encodeURIComponent(api)}`;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register(url).catch(() => undefined);
  });
}
