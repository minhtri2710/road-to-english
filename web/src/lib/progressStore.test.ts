import { afterEach, describe, expect, it, vi } from "vitest";

import { openAppDatabase } from "./db";
import { streakState, todayKey } from "./progress";
import {
  markLessonComplete,
  readProgressSnapshot,
  recordPractice,
} from "./progressStore";
import { setSyncTrigger } from "./syncEvents";

describe("progress store", () => {
  it("reads the day's count and total XP from one progress snapshot", async () => {
    await recordPractice("2026-01-04", { newCard: false });
    await recordPractice("2026-01-05", { newCard: true });
    await markLessonComplete("lesson-1");
    const open = vi.spyOn(indexedDB, "open");
    const transaction = vi.spyOn(IDBDatabase.prototype, "transaction");
    expect(await readProgressSnapshot("2026-01-05")).toEqual({
      practiceDays: ["2026-01-04", "2026-01-05"], completedLessons: new Set(["lesson-1"]),
      dailyCount: { date: "2026-01-05", actions: 1, newCards: 1 }, xp: 20,
    });
    expect(open).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("notifies a local mutation only after the practice transaction commits", async () => {
    const committed: boolean[] = [];
    let open = 0;
    const transaction = IDBDatabase.prototype.transaction;
    vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(function (this: IDBDatabase, ...args) {
      const tx = transaction.apply(this, args);
      open += 1;
      tx.addEventListener("complete", () => {
        open -= 1;
      });
      return tx;
    });
    setSyncTrigger(() => committed.push(open === 0));
    try {
      await recordPractice("2026-01-05", { newCard: false });
    } finally {
      setSyncTrigger(undefined);
    }

    expect(committed).toEqual([true]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("counts every action and only New-card actions as new cards", async () => {
    await recordPractice("2026-01-05", { newCard: false });
    await recordPractice("2026-01-05", { newCard: true });
    await recordPractice("2026-01-05", { newCard: true });

    const snapshot = await readProgressSnapshot("2026-01-05");
    expect(snapshot.dailyCount).toEqual({
      date: "2026-01-05",
      actions: 3,
      newCards: 2,
    });
    expect(snapshot.practiceDays).toEqual(["2026-01-05"]);
    expect((await readProgressSnapshot("2026-01-06")).dailyCount).toBeNull();
  });

  it("writes the practice day and the daily count in one transaction", async () => {
    const db = await openAppDatabase();
    const proto = Object.getPrototypeOf(db) as { transaction: IDBDatabase["transaction"] };
    db.close();
    const transaction = vi.spyOn(proto, "transaction");

    await recordPractice("2026-01-05", { newCard: true });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect([...(transaction.mock.calls[0][0] as string[])].sort()).toEqual([
      "dailyCounts",
      "practiceDays",
    ]);
    expect(transaction.mock.calls[0][1]).toBe("readwrite");
    const snapshot = await readProgressSnapshot("2026-01-05");
    expect(snapshot.practiceDays).toEqual(["2026-01-05"]);
    expect(snapshot.dailyCount?.actions).toBe(1);
  });

  it("splits actions at local midnight while the streak continues", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 0, 5, 23, 59, 59));
    const before = todayKey(new Date());
    await recordPractice(before, { newCard: true });
    vi.setSystemTime(new Date(2026, 0, 6, 0, 0, 1));
    const after = todayKey(new Date());
    await recordPractice(after, { newCard: false });

    expect([before, after]).toEqual(["2026-01-05", "2026-01-06"]);
    expect((await readProgressSnapshot(before)).dailyCount).toEqual({ date: before, actions: 1, newCards: 1 });
    const snapshot = await readProgressSnapshot(after);
    expect(snapshot.dailyCount).toEqual({ date: after, actions: 1, newCards: 0 });
    expect(streakState(snapshot.practiceDays, after).streak).toBe(2);
  });
});
