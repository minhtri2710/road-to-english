import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist", "node_modules", "test-results", "playwright-report"],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // The service worker runs in its own global scope, not the page's.
    files: ["public/sw.js"],
    languageOptions: {
      globals: { self: "readonly", caches: "readonly", fetch: "readonly", URL: "readonly", Promise: "readonly" },
    },
  },
);
