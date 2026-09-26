import { describe, expect, it } from "vitest";

import { assertApiUrl } from "./api-url-guard.mjs";

describe("assertApiUrl", () => {
  it.each([undefined, "", " ", "\t\n"])("rejects missing or blank values (%s)", (value) => {
    expect(() => assertApiUrl(value)).toThrow(/VITE_API_URL.*web\/.env\.example/);
  });

  it("accepts a configured API URL", () => {
    expect(() => assertApiUrl("https://api.example.test")).not.toThrow();
  });
});
