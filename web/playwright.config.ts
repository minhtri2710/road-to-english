import { defineConfig, devices } from "@playwright/test";

function localPort(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const port = Number(value);
  if (!/^\d+$/.test(value) || port < 1 || port > 65535) throw new Error("Invalid E2E port");
  return port;
}
const API_PORT = localPort(process.env.RTE_E2E_API_PORT, 8787);
const WEB_PORT = localPort(process.env.RTE_E2E_WEB_PORT, 5183);
const dsn = process.env.RTE_TEST_DATABASE_URL;
const db = dsn && URL.canParse(dsn) ? new URL(dsn) : null;
if (
  !db ||
  !["postgres:", "postgresql:"].includes(db.protocol) ||
  !["localhost", "127.0.0.1", "[::1]"].includes(db.hostname) ||
  db.username !== "rte_test" ||
  db.pathname !== "/rte_test" ||
  db.hash ||
  (db.search !== "" && db.search !== "?sslmode=disable")
) {
  throw new Error("Set RTE_TEST_DATABASE_URL to the dedicated local rte_test database and role (see README).");
}

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results",
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: "list",
  // The 342-test suite takes about 15 minutes on a GitHub runner (one worker); 30 leaves loaded-host headroom.
  globalTimeout: 1_800_000,
  use: {
    baseURL: `http://localhost:${WEB_PORT}`,
    headless: true,
    trace: "retain-on-failure",
    launchOptions: {
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    {
      command: "go -C ../api run .",
      url: `http://localhost:${API_PORT}/healthz`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        PORT: String(API_PORT),
        CORS_ORIGIN: `http://localhost:${WEB_PORT}`,
        DATABASE_URL: db.href,
      },
    },
    {
      command: `vite --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      reuseExistingServer: false,
      env: { VITE_API_URL: `http://localhost:${API_PORT}` },
    },
  ],
});
