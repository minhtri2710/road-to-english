import { describe, expect, it } from "vitest";

import { streakState, todayKey, weekView, xp } from "./progress";

// Day keys for consecutive calendar days starting at 2026-01-01.
function run(start: number, length: number): string[] {
  return Array.from({ length }, (_, index) => todayKey(new Date(2026, 0, start + index)));
}

const day = (offset: number) => todayKey(new Date(2026, 0, offset));

describe("progress logic", () => {
  it("counts a streak ending today", () => {
    expect(streakState(["2026-01-05"], "2026-01-05").streak).toBe(1);
    expect(streakState(["2026-01-04", "2026-01-05"], "2026-01-05").streak).toBe(2);
  });

  it("keeps yesterday's streak alive", () => {
    expect(streakState(["2026-01-04"], "2026-01-05").streak).toBe(1);
  });

  it("returns zero after a gap", () => {
    expect(streakState(["2026-01-03"], "2026-01-05").streak).toBe(0);
  });

  it("crosses a month boundary", () => {
    expect(streakState(["2026-01-31", "2026-02-01"], "2026-02-01").streak).toBe(2);
  });

  it("crosses a year boundary", () => {
    expect(streakState(["2025-12-31", "2026-01-01"], "2026-01-01").streak).toBe(2);
  });

  it("crosses leap day", () => {
    expect(streakState(["2028-02-28", "2028-02-29"], "2028-02-29").streak).toBe(2);
  });

  it.each([
    { name: "7 consecutive days earn a freeze", days: run(1, 7), today: day(7), streak: 7, freezes: 1 },
    { name: "14 consecutive days earn two freezes", days: run(1, 14), today: day(14), streak: 14, freezes: 2 },
    { name: "21 consecutive days stay capped at two freezes", days: run(1, 21), today: day(21), streak: 21, freezes: 2 },
    { name: "a freeze bridges one missed day", days: [...run(1, 7), day(9)], today: day(9), streak: 8, freezes: 0 },
    { name: "one missed day without a freeze resets", days: [...run(1, 6), day(8)], today: day(8), streak: 1, freezes: 0 },
    { name: "two missed days reset and keep the freeze", days: [...run(1, 7), day(10)], today: day(10), streak: 1, freezes: 1 },
    {
      name: "two freezes bridge two separate missed days",
      days: [...run(1, 14), day(16), day(18)],
      today: day(18),
      streak: 16,
      freezes: 0,
    },
    { name: "a held freeze covers yesterday", days: run(1, 7), today: day(9), streak: 7, freezes: 0 },
    { name: "no freeze leaves the day before yesterday dead", days: run(1, 6), today: day(8), streak: 0, freezes: 0 },
  ])("$name", ({ days, today, streak, freezes }) => {
    expect(streakState(days, today)).toEqual({ streak, freezes });
  });

  it("sums actions across days into XP", () => {
    expect(xp([])).toBe(0);
    expect(
      xp([
        { actions: 3 },
        { actions: 4 },
      ]),
    ).toBe(70);
  });

  it("formats a local calendar date with padding", () => {
    expect(todayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });

  it("lists the last 7 local days ending today with weekday labels and practice", () => {
    // 2026-01-05 is a Monday.
    expect(weekView(["2026-01-05", "2026-01-01", "2025-12-29", "2026-01-06"], "2026-01-05")).toEqual([
      { key: "2025-12-30", label: "Tue", practiced: false },
      { key: "2025-12-31", label: "Wed", practiced: false },
      { key: "2026-01-01", label: "Thu", practiced: true },
      { key: "2026-01-02", label: "Fri", practiced: false },
      { key: "2026-01-03", label: "Sat", practiced: false },
      { key: "2026-01-04", label: "Sun", practiced: false },
      { key: "2026-01-05", label: "Mon", practiced: true },
    ]);
  });

  it("crosses a month boundary, including a leap-year February", () => {
    expect(weekView([], "2024-03-02").map(({ key }) => key)).toEqual([
      "2024-02-25",
      "2024-02-26",
      "2024-02-27",
      "2024-02-28",
      "2024-02-29",
      "2024-03-01",
      "2024-03-02",
    ]);
    expect(weekView([], "2026-10-03").map(({ key }) => key)[0]).toBe("2026-09-27");
  });
});
