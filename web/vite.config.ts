import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import stylex from "@stylexjs/unplugin/vite";

const stylexPlugin = stylex();
// @stylexjs/unplugin 0.19.1 clears its CSS-update interval only on httpServer close, which Vitest's server lacks; drop this when upstream clears it on server close.
if (process.env.VITEST) {
  delete stylexPlugin.configureServer;
}

export default defineConfig({
  plugins: [react(), stylexPlugin],
  test: {
    environment: "happy-dom",
    setupFiles: "./src/test/setup.ts",
  },
});
