import { expect, test, type TestInfo } from "@playwright/test";

// The service worker only ships in the built app, so this test builds it into the test's own output dir, serves
// it with `vite preview`, and adds fixture routes beside the real files. The fixtures stand in for private
// account data (/me), a public-looking route the app does not own (/public-sentinel), the lesson API it may
// cache (/lessons...), and an inert page (/fixture) used to seed another app's caches on this origin.
const LESSON = {
  id: "pwa-fixture",
  title: "Offline practice",
  level: "A1",
  targetWpm: 90,
  sentences: [{ id: "pwa-1", text: "The rain in Spain stays mainly on the plain.", vi: "Câu thử nghiệm." }],
};

// Builds the app into the test's own output dir and serves it with the fixture middleware, returning the
// base URL, the per-path request counts and the server's close.
async function serveBuiltApp(testInfo: TestInfo) {
  const outDir = testInfo.outputPath("dist");
  const { build, preview } = await import("vite");
  await build({
    logLevel: "error",
    define: { "import.meta.env.VITE_API_URL": JSON.stringify("") },
    build: { outDir, emptyOutDir: false },
  });
  const hits = new Map<string, number>();
  const server = await preview({
    logLevel: "error",
    build: { outDir },
    preview: { host: "127.0.0.1", port: 0 },
    plugins: [
      {
        name: "pwa-fixture",
        configurePreviewServer(previewServer) {
          previewServer.middlewares.use((req, res, next) => {
            const url = new URL(req.url ?? "/", "http://127.0.0.1");
            hits.set(url.pathname, (hits.get(url.pathname) ?? 0) + 1);
            const send = (body: string, type: string, noStore = false) => {
              res.writeHead(200, {
                "content-type": type,
                ...(noStore ? { "cache-control": "no-store" } : {}),
              });
              res.end(body);
            };
            if (url.pathname === "/fixture") {
              send("<!doctype html><title>fixture</title>", "text/html");
            } else if (url.pathname === "/icons/apple-touch-icon.png") {
              // An allowlisted route whose response forbids storage: must stay out of every cache.
              send("fake-png", "image/png", true);
            } else if (url.pathname === "/icons/icon.svg") {
              // A harmless redirect on an allowlisted route: the redirect's target is never a cache entry.
              res.writeHead(302, { location: "/icons/apple-touch-icon.png" });
              res.end();
            } else if (url.pathname === "/icons/vary-icon.svg") {
              res.writeHead(200, { "content-type": "image/svg+xml", vary: "Accept-Language" });
              res.end("<svg/>");
            } else if (url.pathname === "/lessons") {
              send(JSON.stringify([{ id: LESSON.id, title: LESSON.title, level: "A1", sentenceCount: 1, targetWpm: 90 }]), "application/json");
            } else if (url.pathname === "/lessons/pwa-fixture") {
              send(JSON.stringify(LESSON), "application/json");
            } else if (url.pathname === "/lessons/pwa-private") {
              // A handled route whose response says no-store: must not land in the lessons cache.
              send(JSON.stringify(LESSON), "application/json", true);
            } else if (url.pathname === "/me") {
              send(JSON.stringify({ id: "fixture-account", email: "offline@example.invalid" }), "application/json", true);
            } else if (url.pathname === "/public-sentinel") {
              send("public sentinel", "text/plain");
            } else {
              next();
            }
          });
        },
      },
    ],
  });
  const address = server.httpServer.address();
  if (!address || typeof address === "string") throw new Error("preview server has no port");
  return { base: `http://127.0.0.1:${address.port}`, hits, close: () => server.close() };
}

test("caches only its own routes and keeps another app's caches on the same origin through an offline reload", async ({
  page,
  context,
}, testInfo) => {
  const { base, hits, close } = await serveBuiltApp(testInfo);
  try {
    const appCachePaths = () =>
      page.evaluate(async () => {
        const names = (await caches.keys()).filter((name) => name.startsWith("road-to-english:"));
        const stored = await Promise.all(names.map(async (name) => (await caches.open(name)).keys()));
        return stored.flat().map((request) => new URL(request.url).pathname);
      });
    const neighborValue = () =>
      page.evaluate(async () => (await (await caches.open("neighbor-app")).match("/kept"))?.text());
    const otherScopeValue = () =>
      page.evaluate(
        async (name) => (await (await caches.open(name)).match("/legacy"))?.text(),
        "road-to-english:%2Fother-scope%2F:shell-v1",
      );

    // Seed caches that do not belong to this registration: another app's, and this app's other scope prefix.
    await page.goto(`${base}/fixture`);
    await page.evaluate(async () => {
      await (await caches.open("neighbor-app")).put("/kept", new Response("neighbor"));
      await (await caches.open("road-to-english:%2Fother-scope%2F:shell-v1")).put("/legacy", new Response("legacy"));
    });

    await page.addInitScript(() => localStorage.setItem("road-to-english.welcomed", "done"));
    await page.goto(`${base}/`);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

    // Activation deletes only this registration's own caches.
    expect(await neighborValue()).toBe("neighbor");
    expect(await otherScopeValue()).toBe("legacy");
    const installed = await appCachePaths();
    expect(installed).toContain("/manifest.webmanifest");
    expect(installed.some((path) => path.startsWith("/assets/"))).toBe(true);
    expect(installed).not.toContain("/fixture");
    // The install precaches the lazy screens' own chunks but no optional data like the dictionary.
    expect(installed.some((path) => path.includes("stressDict"))).toBe(false);
    // Allowlisted routes whose responses forbid storage were fetched on install but never cached.
    expect(installed).not.toContain("/icons/apple-touch-icon.png");
    expect(installed).not.toContain("/icons/icon.svg");

    // Fetch routes the worker must leave alone or must not store.
    expect(await page.evaluate(async () => (await fetch("/lessons/pwa-private", { cache: "no-store" })).status)).toBe(200);
    expect(await page.evaluate(async () => (await fetch("/me", { cache: "no-store" })).status)).toBe(200);
    expect(await page.evaluate(async () => (await fetch("/public-sentinel", { cache: "no-store" })).text())).toBe("public sentinel");
    // A handled route answering Vary: Accept-Language is not a public representation: never stored.
    expect(await page.evaluate(async () => (await fetch("/icons/vary-icon.svg", { cache: "no-store" })).status)).toBe(200);
    const afterReads = await appCachePaths();
    expect(afterReads).not.toContain("/lessons/pwa-private");
    expect(afterReads).not.toContain("/me");
    expect(afterReads).not.toContain("/public-sentinel");
    expect(afterReads).not.toContain("/fixture");
    expect(afterReads).not.toContain("/icons/vary-icon.svg");
    expect(afterReads).not.toContain("/icons/apple-touch-icon.png");

    // Open the lesson from its library button: its data and view code land in the caches through the
    // real request path, then the page reloads offline.
    await page.getByRole("button", { name: "Offline practice" }).click();
    await expect(page.getByRole("heading", { name: "Offline practice" })).toBeVisible();
    await expect(page.getByText(LESSON.sentences[0].text)).toBeVisible();
    expect(await appCachePaths()).toContain("/lessons/pwa-fixture");
    const lessonHits = hits.get("/lessons/pwa-fixture") ?? 0;
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Offline practice" })).toBeVisible();
    await expect(page.getByText(LESSON.sentences[0].text)).toBeVisible();
    // The offline page came from the caches: no fixture route was hit again.
    expect(hits.get("/lessons/pwa-fixture") ?? 0).toBe(lessonHits);
    // An unvisited lazy screen still renders offline: its chunk was installed, not fetched on demand.
    await page.getByRole("link", { name: "Review", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Review deck" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Go to library" })).toBeVisible();
    // Private and unlisted GETs are not replayed offline; the neighbor's and other scope's caches survive.
    expect(await page.evaluate(async () => (await fetch("/me").catch(() => null))?.status ?? 0)).toBe(0);
    expect(await page.evaluate(async () => (await fetch("/public-sentinel").catch(() => null))?.status ?? 0)).toBe(0);
    expect(await neighborValue()).toBe("neighbor");
    expect(await otherScopeValue()).toBe("legacy");
  } finally {
    await context.setOffline(false);
    await close();
  }
});

test("reopens a cold deep link offline after the first visit replays its own requests", async ({ browser }, testInfo) => {
  const { base, hits, close } = await serveBuiltApp(testInfo);
  // A blank context is a cold profile: the first page ever is the lesson deep link itself.
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.addInitScript(() => localStorage.setItem("road-to-english.welcomed", "done"));
    await page.goto(`${base}/#/lesson/pwa-fixture`);
    await expect(page.getByRole("heading", { name: "Offline practice" })).toBeVisible();
    await expect(page.getByText(LESSON.sentences[0].text)).toBeVisible();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

    const appCachePaths = () =>
      page.evaluate(async () => {
        const names = (await caches.keys()).filter((name) => name.startsWith("road-to-english:"));
        const stored = await Promise.all(names.map(async (name) => (await caches.open(name)).keys()));
        return stored.flat().map((request) => new URL(request.url).pathname);
      });
    // The resources this first visit already requested land in the caches once the worker takes control.
    await expect.poll(appCachePaths).toContain("/lessons/pwa-fixture");
    const cached = await appCachePaths();
    expect(cached.filter((path) => path.startsWith("/assets/") && path.endsWith(".js")).length).toBeGreaterThan(1);
    expect(cached).not.toContain("/me");

    const lessonHits = hits.get("/lessons/pwa-fixture") ?? 0;
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Offline practice" })).toBeVisible();
    await expect(page.getByText(LESSON.sentences[0].text)).toBeVisible();
    // The offline page came from the caches: no fixture route was hit again.
    expect(hits.get("/lessons/pwa-fixture") ?? 0).toBe(lessonHits);
  } finally {
    await context.setOffline(false).catch(() => undefined);
    await context.close();
    await close();
  }
});
