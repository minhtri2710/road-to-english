import { afterEach, describe, expect, it, vi } from "vitest";

import { syncState } from "./sync";
import { ApiError } from "./client";

const fetchMock = vi.fn<typeof fetch>();
const SYNC_EPOCH = "epoch-1";
const local = {
  cards: [],
  practiceDays: [],
  lessonCompletion: [], learnProgress: [],
};
const response = {
  cards: [],
  practiceDays: [{ date: "2026-01-01" }],
  lessonCompletion: [{ lessonId: "lesson-1" }], learnProgress: [],
  syncEpoch: SYNC_EPOCH,
};

describe("sync API", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    fetchMock.mockReset();
  });

  it("posts the full local state and revives the response", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(syncState(local, "user-1")).resolves.toEqual(response);
    expect(fetchMock).toHaveBeenCalledWith("/sync", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json", "X-RTE-Sync-Owner": "user-1" },
      body: JSON.stringify(local),
    });
  });

  it("rejects a 200 missing learnProgress through the shared validator", async () => {
    const { learnProgress: _omitted, ...older } = response;
    void _omitted;
    fetchMock.mockResolvedValue(new Response(JSON.stringify(older), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(syncState(local, "user-1")).rejects.not.toBeInstanceOf(ApiError);
  });

  it("rejects an invalid response through the shared validator", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ...response, practiceDays: [{ date: "2026-02-30" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(syncState(local, "user-1")).rejects.toThrow();
  });
});

describe("sync API epoch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    fetchMock.mockReset();
  });

  it.each([["missing", undefined], ["empty", ""], ["not a string", 1]])("rejects a 200 whose syncEpoch is %s", async (_name, syncEpoch) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ ...response, syncEpoch }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(syncState(local, "user-1")).rejects.not.toBeInstanceOf(ApiError);
  });
});
