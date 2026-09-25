import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError, NetworkError } from "../api/client";
import { syncState } from "../api/sync";
import { createSyncScheduler, syncedAgo, type SyncStatus } from "./syncScheduler";
import { getAllCards } from "./vocabStore";
import { putCard } from "./vocabStore";
import { setSyncTrigger } from "./syncEvents";
import * as backupStore from "./backupStore";
import { card as fixtureCard, deferred } from "../test/fixtures";
import { IDBFactory } from "fake-indexeddb";
import { exportData, importData } from "./backup";
import { exportBackupData, replaceAll } from "./backupStore";
import { withDb } from "./db";
import type { VocabCard } from "./vocab";

vi.mock("../api/sync", () => ({ syncState: vi.fn() }));

const syncMock = vi.mocked(syncState);
const now = new Date("2026-01-01T00:00:00Z");
const SYNC_EPOCH = "epoch-1";

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
    const olderResponse = { cards: [initial], practiceDays: [], lessonCompletion: [], syncEpoch: SYNC_EPOCH };
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
    syncMock.mockResolvedValue({ cards: [], practiceDays: [], lessonCompletion: [], syncEpoch: SYNC_EPOCH });
    const scheduler = createSyncScheduler("user-1", async () => undefined, () => undefined);
    setSyncTrigger(scheduler.trigger);

    await putCard(card("2026-01-02T00:00:00Z"));

    await vi.waitFor(() => expect(syncMock).toHaveBeenCalledTimes(1));
    scheduler.stop();
  });

  it("does not sync a local mutation while signed out", async () => {
    syncMock.mockResolvedValue({ cards: [], practiceDays: [], lessonCompletion: [], syncEpoch: SYNC_EPOCH });

    await putCard(card("2026-01-02T00:00:00Z"));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(syncMock).not.toHaveBeenCalled();
  });

  it("coalesces triggers during one request into one follow-up", async () => {
    const first = deferred<{ cards: never[]; practiceDays: never[]; lessonCompletion: never[]; syncEpoch: string }>();
    const second = deferred<{ cards: never[]; practiceDays: never[]; lessonCompletion: never[]; syncEpoch: string }>();
    syncMock.mockImplementationOnce(async () => first.promise);
    syncMock.mockImplementationOnce(async () => second.promise);
    const statuses: SyncStatus[] = [];
    const scheduler = createSyncScheduler("user-1", async () => undefined, (status) => statuses.push(status));

    scheduler.trigger();
    await vi.waitFor(() => expect(syncMock).toHaveBeenCalledTimes(1));
    scheduler.trigger();
    scheduler.trigger();
    expect(syncMock).toHaveBeenCalledTimes(1);

    first.resolve({ cards: [], practiceDays: [], lessonCompletion: [], syncEpoch: SYNC_EPOCH });
    await vi.waitFor(() => expect(syncMock).toHaveBeenCalledTimes(2));

    second.resolve({ cards: [], practiceDays: [], lessonCompletion: [], syncEpoch: SYNC_EPOCH });
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

    syncMock.mockResolvedValue({ cards: [], practiceDays: [], lessonCompletion: [], syncEpoch: SYNC_EPOCH });
    const statuses: SyncStatus[] = [];
    const scheduler = createSyncScheduler("user-1", async () => undefined, (status) => statuses.push(status));
    scheduler.trigger();
    await vi.waitFor(() => expect(statuses).toEqual(["ownerMismatch"]));

    expect(syncMock).not.toHaveBeenCalled();
    expect(await getAllCards()).toEqual([existing]);
    scheduler.stop();
  });

  it("reports an offline sync, a 401 as signed out, and success after a failure", async () => {
    const statuses: SyncStatus[] = [];
    syncMock.mockRejectedValueOnce(new NetworkError(new TypeError("Failed to fetch")));
    syncMock.mockRejectedValueOnce(new ApiError(401, null));
    syncMock.mockResolvedValueOnce({ cards: [], practiceDays: [], lessonCompletion: [], syncEpoch: SYNC_EPOCH });
    const scheduler = createSyncScheduler("user-1", async () => undefined, (status) => statuses.push(status));

    scheduler.trigger();
    await vi.waitFor(() => expect(statuses).toEqual(["offline"]));

    scheduler.trigger();
    await vi.waitFor(() => expect(statuses).toEqual(["offline", "signedOut"]));

    scheduler.trigger();
    await vi.waitFor(() => expect(statuses).toEqual(["offline", "signedOut", "synced"]));
    scheduler.stop();
  });

  it("reports a server error as a server failure, not signed out", async () => {
    const statuses: SyncStatus[] = [];
    syncMock.mockRejectedValueOnce(new ApiError(500, null));
    const scheduler = createSyncScheduler("user-1", async () => undefined, (status) => statuses.push(status));

    scheduler.trigger();
    await vi.waitFor(() => expect(statuses).toEqual(["server"]));
    scheduler.stop();
  });

  const empty = { cards: [], practiceDays: [], lessonCompletion: [], syncEpoch: SYNC_EPOCH };
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

describe("sync scheduler failures", () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  beforeEach(async () => {
    const { syncState: realSyncState } = await vi.importActual<typeof import("../api/sync")>("../api/sync");
    syncMock.mockReset();
    syncMock.mockImplementation(realSyncState);
    setSyncTrigger(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // Runs the real syncState against fetchImpl, triggering twice with unchanged data.
  async function twice(fetchImpl: () => Promise<Response>): Promise<{ statuses: SyncStatus[]; fetch: ReturnType<typeof vi.fn> }> {
    const fetch = vi.fn(fetchImpl);
    vi.stubGlobal("fetch", fetch);
    const statuses: SyncStatus[] = [];
    const scheduler = createSyncScheduler("user-1", async () => undefined, (status) => statuses.push(status));
    scheduler.trigger();
    await vi.waitFor(() => expect(statuses).toHaveLength(1));
    scheduler.trigger();
    await vi.waitFor(() => expect(statuses).toHaveLength(2));
    scheduler.stop();
    return { statuses, fetch };
  }

  it.each<[string, SyncStatus, () => Promise<Response>]>([
    ["a network failure", "offline", async () => { throw new TypeError("Failed to fetch"); }],
    ["a 500", "server", async () => json({ error: "internal error" }, 500)],
    ["a 502 non-JSON proxy page", "server", async () => new Response("<html>Bad Gateway</html>", { status: 502 })],
    ["a 200 non-JSON body", "badReply", async () => new Response("<html>ok</html>", { status: 200 })],
    ["a 200 invalid state shape", "badReply", async () => json({ cards: "nope" })],
  ])("reports %s as %s and retries it on the next unchanged trigger", async (_name, status, fetchImpl) => {
    const { statuses, fetch } = await twice(fetchImpl);
    expect(statuses).toEqual([status, status]);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["export", () => vi.spyOn(backupStore, "exportAll").mockRejectedValue(new DOMException("read failed", "UnknownError"))],
    ["merge", () => vi.spyOn(backupStore, "mergeInto").mockRejectedValue(new DOMException("write failed", "UnknownError"))],
  ])("reports an IndexedDB %s failure as local and retries it on the next unchanged trigger", async (_name, fail) => {
    const spy = fail();
    const { statuses } = await twice(async () => json({ cards: [], practiceDays: [], lessonCompletion: [], syncEpoch: SYNC_EPOCH }));
    expect(statuses).toEqual(["local", "local"]);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("reports a failed reload after a merge as local", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ cards: [], practiceDays: [], lessonCompletion: [], syncEpoch: SYNC_EPOCH })));
    const statuses: SyncStatus[] = [];
    const scheduler = createSyncScheduler("user-1", async () => { throw new Error("reload failed"); }, (status) => statuses.push(status));
    scheduler.trigger();
    await vi.waitFor(() => expect(statuses).toEqual(["local"]));
    scheduler.stop();
  });

  it("sends an unchanged body rejected with 400 no more, and a changed body once", async () => {
    await putCard(card("2026-01-02T00:00:00Z"));
    const { statuses, fetch } = await twice(async () => json({ error: "invalid sync state" }, 400));
    expect(statuses).toEqual(["rejected", "rejected"]);
    expect(fetch).toHaveBeenCalledTimes(1);

    const later: SyncStatus[] = [];
    const scheduler = createSyncScheduler("user-1", async () => undefined, (status) => later.push(status));
    setSyncTrigger(scheduler.trigger);
    await putCard(card("2026-01-03T00:00:00Z"));
    await vi.waitFor(() => expect(later).toEqual(["rejected"]));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(fetch).toHaveBeenCalledTimes(2);
    scheduler.stop();
  });

  it("forgets the rejected body after a 200", async () => {
    await putCard(card("2026-01-02T00:00:00Z"));
    const fetch = vi.fn(async () => json({ error: "invalid sync state" }, 400));
    vi.stubGlobal("fetch", fetch);
    const statuses: SyncStatus[] = [];
    const scheduler = createSyncScheduler("user-1", async () => undefined, (status) => statuses.push(status));
    scheduler.trigger();
    await vi.waitFor(() => expect(statuses).toEqual(["rejected"]));

    fetch.mockImplementation(async () => json({ cards: [], practiceDays: [], lessonCompletion: [], syncEpoch: SYNC_EPOCH }));
    await putCard(card("2026-01-03T00:00:00Z"));
    scheduler.trigger();
    await vi.waitFor(() => expect(statuses).toEqual(["rejected", "synced"]));
    await putCard(card("2026-01-02T00:00:00Z"));
    scheduler.trigger();
    await vi.waitFor(() => expect(statuses).toEqual(["rejected", "synced", "synced"]));
    expect(fetch).toHaveBeenCalledTimes(3);
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

describe("sync scheduler settle step", () => {
  const storedCards = () => withDb((db) => db.getAll("cards"));
  const reply = (cards: VocabCard[], syncEpoch = SYNC_EPOCH) => ({ cards, practiceDays: [], lessonCompletion: [], syncEpoch });
  const sentCards = (call: number) => syncMock.mock.calls[call]![0].cards;

  beforeEach(() => {
    syncMock.mockReset();
    setSyncTrigger(undefined);
  });

  // Triggers once and waits for `runs` reported statuses.
  async function run(runs = 1): Promise<SyncStatus[]> {
    const statuses: SyncStatus[] = [];
    const scheduler = createSyncScheduler("user-1", async () => undefined, (status) => statuses.push(status));
    scheduler.trigger();
    await vi.waitFor(() => expect(statuses).toHaveLength(runs));
    await new Promise((resolve) => setTimeout(resolve, 20));
    scheduler.stop();
    return statuses;
  }

  // W3: a settled card present in the reply is stored clean.
  it("stores a settled card present in the reply clean", async () => {
    const x = card("2026-01-02T00:00:00Z");
    await putCard(x);
    syncMock.mockResolvedValueOnce(reply([x]));
    expect(await run()).toEqual(["synced"]);
    expect(sentCards(0)).toEqual([{ ...x, dirty: true }]);
    expect(await storedCards()).toEqual([{ ...x, dirty: false }]);
  });

  // W3: a settled card absent from the reply was purged, or the server never had it: it is deleted.
  it("deletes a settled card absent from the reply", async () => {
    await putCard(card("2026-01-02T00:00:00Z"));
    syncMock.mockResolvedValueOnce(reply([]));
    expect(await run()).toEqual(["synced"]);
    expect(await storedCards()).toEqual([]);
  });

  // W3: a card edited while the request is in flight stays dirty and is never deleted.
  it("keeps a card edited mid-request dirty, present or absent", async () => {
    for (const present of [false, true]) {
      indexedDB = new IDBFactory();
      syncMock.mockReset();
      const sent = card("2026-01-02T00:00:00Z");
      const edited = { ...sent, front: "edited", updatedAt: "2026-01-03T00:00:00.000Z" };
      await putCard(sent);
      const held = deferred<ReturnType<typeof reply>>();
      syncMock.mockImplementationOnce(async () => held.promise);
      const statuses = run();
      await vi.waitFor(() => expect(syncMock).toHaveBeenCalledTimes(1));
      await putCard(edited);
      held.resolve(reply(present ? [sent] : []));
      expect(await statuses).toEqual(["synced"]);
      expect(await storedCards()).toEqual([{ ...edited, dirty: true }]);
    }
  });

  // W3: a card created while the request is in flight stays dirty and is never deleted.
  it("keeps a card created mid-request dirty", async () => {
    const sent = card("2026-01-02T00:00:00Z");
    const created = fixtureCard("sentence-2", now);
    await putCard(sent);
    const held = deferred<ReturnType<typeof reply>>();
    syncMock.mockImplementationOnce(async () => held.promise);
    const statuses = run();
    await vi.waitFor(() => expect(syncMock).toHaveBeenCalledTimes(1));
    await putCard(created);
    held.resolve(reply([sent]));
    expect(await statuses).toEqual(["synced"]);
    expect(await storedCards()).toEqual([{ ...sent, dirty: false }, { ...created, dirty: true }]);
  });

  // W3: a failed sync clears nothing.
  it.each<[string, SyncStatus, () => Error]>([
    ["a 500", "server", () => new ApiError(500, null)],
    ["a network failure", "offline", () => new NetworkError(new TypeError("Failed to fetch"))],
    ["a 400", "rejected", () => new ApiError(400, null)],
  ])("clears nothing after %s", async (_name, status, error) => {
    const x = card("2026-01-02T00:00:00Z");
    await putCard(x);
    syncMock.mockRejectedValueOnce(error());
    expect(await run()).toEqual([status]);
    expect(await storedCards()).toEqual([{ ...x, dirty: true }]);
  });

  // W4 (S1): a card received from a device whose clock is off by an hour is clean, so a later reply without it deletes it.
  it.each([["+1 h", 3_600_000], ["-1 h", -3_600_000]])("drops a purged card received from a device %s off", async (_name, skew) => {
    const x = fixtureCard("sentence-9", new Date(Date.now() + skew));
    syncMock.mockResolvedValueOnce(reply([x]));
    syncMock.mockResolvedValueOnce(reply([]));
    syncMock.mockResolvedValueOnce(reply([]));
    await run();
    expect(await storedCards()).toEqual([{ ...x, dirty: false }]);
    await run();
    expect(syncMock.mock.results[0]!.type).toBe("return");
    expect((await syncMock.mock.results[0]!.value).syncEpoch).toBe((await syncMock.mock.results[1]!.value).syncEpoch);
    expect(sentCards(1)).toEqual([{ ...x, dirty: false }]);
    expect(await storedCards()).toEqual([]);
    await run();
    expect(sentCards(2)).toEqual([]);
  });

  // W5: an import marks every card dirty, so the next request sends each one dirty.
  it("sends every imported card dirty", async () => {
    const x = card("2026-01-02T00:00:00Z");
    const y = fixtureCard("sentence-2", now);
    syncMock.mockResolvedValueOnce(reply([x, y]));
    await run();
    expect((await storedCards()).map(({ dirty }) => dirty)).toEqual([false, false]);
    await replaceAll(importData(exportData(await exportBackupData(), now)));
    syncMock.mockResolvedValueOnce(reply([x, y]));
    await run();
    expect(sentCards(1).map(({ id, dirty }) => [id, dirty])).toEqual([[x.id, true], [y.id, true]]);
  });

  // W6 (S2): a new epoch means the server lost its copy: nothing is deleted, every card is re-pushed dirty once.
  it("re-pushes every card once after an epoch change instead of deleting", async () => {
    const x = card("2026-01-02T00:00:00Z");
    const y = fixtureCard("sentence-2", now);
    syncMock.mockResolvedValueOnce(reply([x, y], "epoch-1"));
    await run();
    expect(await storedCards()).toEqual([{ ...x, dirty: false }, { ...y, dirty: false }]);

    syncMock.mockReset();
    const followUp = deferred<ReturnType<typeof reply>>();
    syncMock.mockResolvedValueOnce(reply([], "epoch-2"));
    syncMock.mockImplementationOnce(async () => followUp.promise);
    const statuses = run(2);
    await vi.waitFor(() => expect(syncMock).toHaveBeenCalledTimes(2));
    expect(await storedCards()).toEqual([{ ...x, dirty: true }, { ...y, dirty: true }]);
    expect(sentCards(1)).toEqual([{ ...x, dirty: true }, { ...y, dirty: true }]);
    followUp.resolve(reply([x, y], "epoch-2"));
    expect(await statuses).toEqual(["synced", "synced"]);
    expect(syncMock).toHaveBeenCalledTimes(2);
    expect(await storedCards()).toEqual([{ ...x, dirty: false }, { ...y, dirty: false }]);
  });

  // W7 (S2): no stored epoch while clean cards exist is a mismatch too.
  it("treats clean cards without a stored epoch as an epoch change", async () => {
    const x = card("2026-01-02T00:00:00Z");
    await withDb((db) => db.put("cards", { ...x, dirty: false }));
    syncMock.mockResolvedValueOnce(reply([]));
    syncMock.mockResolvedValueOnce(reply([x]));
    expect(await run(2)).toEqual(["synced", "synced"]);
    expect(syncMock).toHaveBeenCalledTimes(2);
    expect(sentCards(0)).toEqual([{ ...x, dirty: false }]);
    expect(sentCards(1)).toEqual([{ ...x, dirty: true }]);
    expect(await storedCards()).toEqual([{ ...x, dirty: false }]);
  });
});
