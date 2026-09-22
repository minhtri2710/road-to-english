import { describe, expect, it } from "vitest";

import { streak, todayKey } from "./progress";

describe("progress logic", () => {
  it("counts a streak ending today", () => {
    expect(streak(["2026-01-05"], "2026-01-05")).toBe(1);
    expect(streak(["2026-01-04", "2026-01-05"], "2026-01-05")).toBe(2);
  });

  it("keeps yesterday's streak alive", () => {
    expect(streak(["2026-01-04"], "2026-01-05")).toBe(1);
  });

  it("returns zero after a gap", () => {
    expect(streak(["2026-01-03"], "2026-01-05")).toBe(0);
  });

  it("crosses a month boundary", () => {
    expect(streak(["2026-01-31", "2026-02-01"], "2026-02-01")).toBe(2);
  });

  it("crosses a year boundary", () => {
    expect(streak(["2025-12-31", "2026-01-01"], "2026-01-01")).toBe(2);
  });

  it("crosses leap day", () => {
    expect(streak(["2028-02-28", "2028-02-29"], "2028-02-29")).toBe(2);
  });

  it("formats a local calendar date with padding", () => {
    expect(todayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});
