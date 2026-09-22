import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import stylex from "@stylexjs/unplugin/vite";

export default defineConfig({
  plugins: [react(), stylex()],
  test: {
    environment: "happy-dom",
    setupFiles: "./src/test/setup.ts",
  },
});
