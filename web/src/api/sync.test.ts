import { afterEach, describe, expect, it, vi } from "vitest";

import { syncState } from "./sync";
import { ApiError } from "./client";

const fetchMock = vi.fn<typeof fetch>();
const local = {
  cards: [],
  practiceDays: [],
  lessonCompletion: [],
};
const response = {
  cards: [],
  practiceDays: [{ date: "2026-01-01" }],
  lessonCompletion: [{ lessonId: "lesson-1" }],
};

describe("sync API", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    fetchMock.mockReset();
  });

  it("posts the full local state and revives the response", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(syncState(local)).resolves.toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith("/sync", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(local),
    });
  });

  it.each([400, 401, 413, 415, 500])("throws ApiError for status %s", async (status) => {
    fetchMock.mockResolvedValue(new Response(null, { status }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(syncState(local)).rejects.toEqual(expect.objectContaining({ status }));
    await expect(syncState(local)).rejects.toBeInstanceOf(ApiError);
  });

  it("rejects an invalid response through the shared validator", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ...response, practiceDays: [{ date: "2026-02-30" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(syncState(local)).rejects.toThrow();
  });
});
