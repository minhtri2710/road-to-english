import { defineConfig, devices } from "@playwright/test";

const API_PORT = 8787;
const WEB_PORT = 5183;

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
        DATABASE_URL: "postgres://rte:rte_dev_password@localhost:5435/rte?sslmode=disable",
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
