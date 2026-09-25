import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../api/client";
import { syncState } from "../api/sync";
import { createSyncScheduler, syncedAgo, type SyncStatus } from "./syncScheduler";
import { getAllCards } from "./vocabStore";
import { putCard } from "./vocabStore";
import { setSyncTrigger } from "./syncEvents";
import { card as fixtureCard, deferred } from "../test/fixtures";

vi.mock("../api/sync", () => ({ syncState: vi.fn() }));

const syncMock = vi.mocked(syncState);
const now = new Date("2026-01-01T00:00:00Z");

function card(lastReview?: string) {
  const value = fixtureCard("sentence-1", now);
  if (lastReview) {
    value.fsrs.last_review = new Date(lastReview);
  }
  return value;
}

describe("sync scheduler", () => {
  beforeEach(() => {
    syncMock.mockReset();
    setSyncTrigger(undefined);
  });

  it("keeps a newer local mutation when the in-flight server response is older", async () => {
    const initial = card("2026-01-02T00:00:00Z");
    const newer = card("2026-01-04T00:00:00Z");
    const olderResponse = { cards: [initial], practiceDays: [], lessonCompletion: [] };
    const first = deferred<typeof olderResponse>();
    const second = deferred<typeof olderResponse>();
    let applied = 0;
    const appliedTwice = deferred<void>();
    syncMock.mockImplementationOnce(async () => first.promise);
    syncMock.mockImplementationOnce(async (local) => {
      expect(local.cards[0]?.fsrs.last_review).toEqual(newer.fsrs.last_review);
      return second.promise;
    });
    await putCard(initial);

    const scheduler = createSyncScheduler("user-1", async () => {
      applied += 1;
      if (applied === 2) {
        appliedTwice.resolve();
      }
    }, () => undefined);
    setSyncTrigger(scheduler.trigger);
    scheduler.trigger();
    for (let attempt = 0; attempt < 20 && syncMock.mock.calls.length < 1; attempt += 1) {
      await Promise.resolve();
    }

    await putCard(newer);
    first.resolve(olderResponse);
    for (let attempt = 0; attempt < 20 && syncMock.mock.calls.length < 2; attempt += 1) {
      await Promise.resolve();
    }

    expect((await getAllCards())[0]?.fsrs.last_review).toEqual(newer.fsrs.last_review);
    second.resolve(olderResponse);
    await appliedTwice.promise;
    scheduler.stop();
  });

  it("syncs a local mutation while signed in", async () => {
    syncMock.mockResolvedValue({ cards: [], practiceDays: [], lessonCompletion: [] });
    const scheduler = createSyncScheduler("user-1", async () => undefined, () => undefined);
    setSyncTrigger(scheduler.trigger);

    await putCard(card("2026-01-02T00:00:00Z"));

    await vi.waitFor(() => expect(syncMock).toHaveBeenCalledTimes(1));
    scheduler.stop();
  });

  it("does not sync a local mutation while signed out", async () => {
    syncMock.mockResolvedValue({ cards: [], practiceDays: [], lessonCompletion: [] });

    await putCard(card("2026-01-02T00:00:00Z"));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(syncMock).not.toHaveBeenCalled();
  });

  it("coalesces triggers during one request into one follow-up", async () => {
    const first = deferred<{ cards: never[]; practiceDays: never[]; lessonCompletion: never[] }>();
    const second = deferred<{ cards: never[]; practiceDays: never[]; lessonCompletion: never[] }>();
    syncMock.mockImplementationOnce(async () => first.promise);
    syncMock.mockImplementationOnce(async () => second.promise);
    const statuses: SyncStatus[] = [];
    const scheduler = createSyncScheduler("user-1", async () => undefined, (status) => statuses.push(status));

    scheduler.trigger();
    await vi.waitFor(() => expect(syncMock).toHaveBeenCalledTimes(1));
    scheduler.trigger();
    scheduler.trigger();
    expect(syncMock).toHaveBeenCalledTimes(1);

    first.resolve({ cards: [], practiceDays: [], lessonCompletion: [] });
    await vi.waitFor(() => expect(syncMock).toHaveBeenCalledTimes(2));

    second.resolve({ cards: [], practiceDays: [], lessonCompletion: [] });
    await vi.waitFor(() => expect(statuses).toEqual(["synced", "synced"]));
    expect(syncMock).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it("refuses an owner mismatch without sending or changing IndexedDB", async () => {
    syncMock.mockReset();
    const existing = card("2026-01-02T00:00:00Z");
    await putCard(existing);
    const { claimOwner } = await import("./backupStore");
    await claimOwner("another-user");

    syncMock.mockResolvedValue({ cards: [], practiceDays: [], lessonCompletion: [] });
    const statuses: SyncStatus[] = [];
    const scheduler = createSyncScheduler("user-1", async () => undefined, (status) => statuses.push(status));
    scheduler.trigger();
    await vi.waitFor(() => expect(statuses).toEqual(["ownerMismatch"]));

    expect(syncMock).not.toHaveBeenCalled();
    expect(await getAllCards()).toEqual([existing]);
    scheduler.stop();
  });

  it("reports a failed sync, a 401 as signed out, and success after a failure", async () => {
    const statuses: SyncStatus[] = [];
    syncMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    syncMock.mockRejectedValueOnce(new ApiError(401, null));
    syncMock.mockResolvedValueOnce({ cards: [], practiceDays: [], lessonCompletion: [] });
    const scheduler = createSyncScheduler("user-1", async () => undefined, (status) => statuses.push(status));

    scheduler.trigger();
    await vi.waitFor(() => expect(statuses).toEqual(["failed"]));

    scheduler.trigger();
    await vi.waitFor(() => expect(statuses).toEqual(["failed", "signedOut"]));

    scheduler.trigger();
    await vi.waitFor(() => expect(statuses).toEqual(["failed", "signedOut", "synced"]));
    scheduler.stop();
  });

  it("reports a server error as a failure, not signed out", async () => {
    const statuses: SyncStatus[] = [];
    syncMock.mockRejectedValueOnce(new ApiError(500, null));
    const scheduler = createSyncScheduler("user-1", async () => undefined, (status) => statuses.push(status));

    scheduler.trigger();
    await vi.waitFor(() => expect(statuses).toEqual(["failed"]));
    scheduler.stop();
  });

  const empty = { cards: [], practiceDays: [], lessonCompletion: [] };
  const tooLarge = () => new ApiError(413, null, "too many cards");

  it("sends an unchanged body refused with 413 no more, whatever triggers the run", async () => {
    const reports: [SyncStatus, string | null][] = [];
    syncMock.mockRejectedValueOnce(tooLarge());
    await putCard(card("2026-01-02T00:00:00Z"));
    const scheduler = createSyncScheduler("user-1", async () => undefined, (status, code) => reports.push([status, code]));

    scheduler.trigger();
    await vi.waitFor(() => expect(reports).toHaveLength(1));
    // Focus, online and visibilitychange each call trigger with the local data unchanged.
    for (let run = 2; run <= 4; run += 1) {
      scheduler.trigger();
      await vi.waitFor(() => expect(reports).toHaveLength(run));
    }

    expect(syncMock).toHaveBeenCalledTimes(1);
    expect(reports).toEqual(Array.from({ length: 4 }, () => ["tooLarge", "too many cards"]));
    scheduler.stop();
  });

  it("sends a changed body once after a 413", async () => {
    const reports: [SyncStatus, string | null][] = [];
    syncMock.mockRejectedValue(tooLarge());
    await putCard(card("2026-01-02T00:00:00Z"));
    const scheduler = createSyncScheduler("user-1", async () => undefined, (status, code) => reports.push([status, code]));
    scheduler.trigger();
    await vi.waitFor(() => expect(reports).toHaveLength(1));
    setSyncTrigger(scheduler.trigger);

    await putCard(card("2026-01-03T00:00:00Z"));
    await vi.waitFor(() => expect(reports).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(syncMock).toHaveBeenCalledTimes(2);
    expect(reports).toEqual([["tooLarge", "too many cards"], ["tooLarge", "too many cards"]]);
    scheduler.stop();
  });

  it("forgets the refused body after a 200", async () => {
    const statuses: SyncStatus[] = [];
    syncMock.mockRejectedValueOnce(tooLarge());
    syncMock.mockResolvedValue(empty);
    await putCard(card("2026-01-02T00:00:00Z"));
    const scheduler = createSyncScheduler("user-1", async () => undefined, (status) => statuses.push(status));
    scheduler.trigger();
    await vi.waitFor(() => expect(statuses).toEqual(["tooLarge"]));

    await putCard(card("2026-01-03T00:00:00Z"));
    scheduler.trigger();
    await vi.waitFor(() => expect(statuses).toEqual(["tooLarge", "synced"]));
    scheduler.trigger();
    await vi.waitFor(() => expect(statuses).toEqual(["tooLarge", "synced", "synced"]));
    // The body the 413 refused is sendable again once a 200 cleared the memory.
    await putCard(card("2026-01-02T00:00:00Z"));
    scheduler.trigger();
    await vi.waitFor(() => expect(statuses).toEqual(["tooLarge", "synced", "synced", "synced"]));

    expect(syncMock).toHaveBeenCalledTimes(4);
    expect(JSON.stringify(syncMock.mock.calls[3]?.[0])).toBe(JSON.stringify(syncMock.mock.calls[0]?.[0]));
    scheduler.stop();
  });
});

describe("syncedAgo", () => {
  const minute = 60_000;

  it.each([
    [0, "Synced just now"],
    [-5_000, "Synced just now"],
    [minute - 1, "Synced just now"],
    [minute, "Synced 1 min ago"],
    [59 * minute + 59_999, "Synced 59 min ago"],
    [60 * minute, "Synced 1 h ago"],
    [25 * 60 * minute, "Synced 25 h ago"],
  ])("formats %i ms as %s", (elapsed, text) => {
    expect(syncedAgo(1_000_000, 1_000_000 + elapsed)).toBe(text);
  });
});
