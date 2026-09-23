import { afterEach, describe, expect, it, vi } from "vitest";

import { exportAll } from "./backupStore";
import { openAppDatabase } from "./db";
import { streakState, todayKey } from "./progress";
import {
  getCompletedLessons,
  getDailyCount,
  getPracticeDays,
  markLessonComplete,
  recordPractice,
} from "./progressStore";

describe("progress store", () => {
  it("round-trips practice days and completed lessons", async () => {
    await recordPractice("2026-01-05", { newCard: false });
    await recordPractice("2026-01-05", { newCard: false });
    await markLessonComplete("lesson-1");

    expect(await getPracticeDays()).toEqual(["2026-01-05"]);
    expect(await getCompletedLessons()).toEqual(["lesson-1"]);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("counts every action and only New-card actions as new cards", async () => {
    await recordPractice("2026-01-05", { newCard: false });
    await recordPractice("2026-01-05", { newCard: true });
    await recordPractice("2026-01-05", { newCard: true });

    expect(await getDailyCount("2026-01-05")).toEqual({
      date: "2026-01-05",
      actions: 3,
      newCards: 2,
    });
    expect(await getPracticeDays()).toEqual(["2026-01-05"]);
    expect(await getDailyCount("2026-01-06")).toEqual({
      date: "2026-01-06",
      actions: 0,
      newCards: 0,
    });
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
    expect(await getPracticeDays()).toEqual(["2026-01-05"]);
    expect((await getDailyCount("2026-01-05")).actions).toBe(1);
  });

  it("keeps daily counts out of the export", async () => {
    await recordPractice("2026-01-05", { newCard: true });

    expect(Object.keys(await exportAll()).sort()).toEqual([
      "cards",
      "lessonCompletion",
      "practiceDays",
    ]);
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
    expect(await getDailyCount(before)).toEqual({ date: before, actions: 1, newCards: 1 });
    expect(await getDailyCount(after)).toEqual({ date: after, actions: 1, newCards: 0 });
    expect(streakState(await getPracticeDays(), after).streak).toBe(2);
  });
});
