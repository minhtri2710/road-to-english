import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "../api/lessons";
import { syncState } from "../api/sync";
import { createSyncScheduler, type SyncStatus } from "./syncScheduler";
import { getAllCards } from "./vocabStore";
import { createCard } from "./vocab";
import { putCard } from "./vocabStore";
import { setSyncTrigger } from "./syncEvents";

vi.mock("../api/sync", () => ({ syncState: vi.fn() }));

const syncMock = vi.mocked(syncState);
const now = new Date("2026-01-01T00:00:00Z");

function card(lastReview?: string) {
  const value = createCard(
    {
      front: "hello",
      back: "answer",
      source: { lessonId: "lesson-1", sentenceId: "sentence-1", word: "" },
    },
    now,
  );
  if (lastReview) {
    value.fsrs.last_review = new Date(lastReview);
  }
  return value;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve;
  });
  return { promise, resolve };
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
    syncMock.mockRejectedValueOnce(new ApiError(401));
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
    syncMock.mockRejectedValueOnce(new ApiError(500));
    const scheduler = createSyncScheduler("user-1", async () => undefined, (status) => statuses.push(status));

    scheduler.trigger();
    await vi.waitFor(() => expect(statuses).toEqual(["failed"]));
    scheduler.stop();
  });
});
