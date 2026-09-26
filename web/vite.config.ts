import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import stylex from "@stylexjs/unplugin/vite";
import { assertApiUrl } from "./scripts/api-url-guard.mjs";

const stylexPlugin = stylex();
// @stylexjs/unplugin 0.19.1 clears its CSS-update interval only on httpServer close, which Vitest's server lacks; drop this when upstream clears it on server close.
if (process.env.VITEST) {
  delete stylexPlugin.configureServer;
}

export default defineConfig(({ command, mode, isPreview }) => {
  if (command === "serve" && !isPreview && !process.env.VITEST) {
    // Hosting has not fixed the production API origin; gate the build too once hosting fixes the production API origin.
    assertApiUrl(loadEnv(mode, process.cwd(), "VITE_").VITE_API_URL);
  }

  return {
    plugins: [react(), stylexPlugin],
    test: {
      environment: "happy-dom",
      setupFiles: "./src/test/setup.ts",
      include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.mjs"],
      // Full StrictMode App renders in React dev under happy-dom take ~0.2-0.5 s alone but reached 16.7 s under 3 concurrent runs on 8 cores.
      testTimeout: 30000,
    },
  };
});
