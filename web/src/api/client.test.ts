import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, request } from "./client";

async function failure(status: number, headers?: Record<string, string>): Promise<ApiError> {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status, headers })));
  const error: unknown = await request("/login").catch((caught: unknown) => caught);
  if (!(error instanceof ApiError)) throw new Error("expected an ApiError");
  return error;
}

describe("request", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads a 429's Retry-After delta-seconds", async () => {
    const error = await failure(429, { "Retry-After": "42" });
    expect(error.status).toBe(429);
    expect(error.retryAfter).toBe(42);
  });

  it.each([
    ["absent", undefined],
    ["zero", "0"],
    ["negative", "-5"],
    ["fractional", "1.5"],
    ["an HTTP date", "Wed, 21 Oct 2026 07:28:00 GMT"],
    ["text", "soon"],
    ["too large to be exact", "9007199254740993"],
  ])("treats a 429 with Retry-After %s as no wait", async (_name, value) => {
    const error = await failure(429, value === undefined ? undefined : { "Retry-After": value });
    expect(error.retryAfter).toBeNull();
  });

  it("ignores Retry-After on other statuses", async () => {
    const error = await failure(503, { "Retry-After": "42" });
    expect(error.status).toBe(503);
    expect(error.retryAfter).toBeNull();
  });
});
