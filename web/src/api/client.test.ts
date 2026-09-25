import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, NetworkError, request } from "./client";

async function failure(status: number, headers?: Record<string, string>, body: string | null = null): Promise<ApiError> {
  vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(new Response(body, { status, headers })));
  const error: unknown = await request("/login").catch((caught: unknown) => caught);
  if (!(error instanceof ApiError)) throw new Error("expected an ApiError");
  return error;
}

describe("request", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("throws a NetworkError carrying the fetch rejection as its cause", async () => {
    const cause = new TypeError("Failed to fetch");
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockRejectedValue(cause));
    const error: unknown = await request("/sync").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NetworkError);
    expect(error).not.toBeInstanceOf(ApiError);
    expect((error as NetworkError).cause).toBe(cause);
    expect((error as NetworkError).message).toBe("Failed to fetch");
  });

  it("still throws an ApiError for a non-ok response", async () => {
    const error = await failure(500);
    expect(error).not.toBeInstanceOf(NetworkError);
    expect(error.status).toBe(500);
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

  it("reads the code from a JSON error body", async () => {
    const error = await failure(413, undefined, JSON.stringify({ error: "too many cards" }));
    expect(error.status).toBe(413);
    expect(error.code).toBe("too many cards");
  });

  it.each([
    ["no body", null],
    ["a non-JSON body", "request body too large\n"],
    ["a JSON body without a string error", JSON.stringify({ error: 413 })],
    ["a JSON null body", "null"],
  ])("reads a null code from %s", async (_name, body) => {
    const error = await failure(413, undefined, body);
    expect(error.code).toBeNull();
  });

  it("keeps a 429's Retry-After alongside its code", async () => {
    const error = await failure(429, { "Retry-After": "42" }, JSON.stringify({ error: "too many requests" }));
    expect(error.retryAfter).toBe(42);
    expect(error.code).toBe("too many requests");
  });
});
