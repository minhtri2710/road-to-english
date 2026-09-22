import { describe, expect, it } from "vitest";

import { isValidDayKey, isValidTimestamp, reviveBackupData } from "./backup";

function state(overrides: Record<string, unknown> = {}) {
  return {
    cards: [
      {
        id: "lesson-1:sentence-1",
        front: "hello",
        back: "answer",
        source: { lessonId: "lesson-1", sentenceId: "sentence-1" },
        fsrs: { due: "2026-01-01T00:00:00Z" },
      },
    ],
    practiceDays: [{ date: "2026-01-01" }],
    lessonCompletion: [{ lessonId: "lesson-1" }],
    ...overrides,
  };
}

describe("sync state validation", () => {
  it.each([
    ["2026-01-01T00:00:00Z", true],
    ["0001-01-01T00:00:00.123456Z", true],
    ["2026-01-01T00:00:00+07:00", false],
    ["2026-02-30T00:00:00Z", false],
    ["2026-01-01T24:00:00Z", false],
    ["2026-01-01T00:60:00Z", false],
    ["2026-01-01T00:00:60Z", false],
    ["0000-01-01T00:00:00Z", false],
    ["2026", false],
  ])("timestamp %s is %s", (value, valid) => {
    expect(isValidTimestamp(value)).toBe(valid);
  });

  it.each([
    ["2026-01-01", true],
    ["2024-02-29", true],
    ["2026-02-30", false],
    ["2026-13-01", false],
    ["2026-1-1", false],
    ["0000-01-01", false],
    ["2026", false],
  ])("day key %s is %s", (value, valid) => {
    expect(isValidDayKey(value)).toBe(valid);
  });

  it("revives valid timestamps and dates", () => {
    const revived = reviveBackupData({
      ...state(),
      cards: [
        {
          ...state().cards[0],
          fsrs: {
            due: "0001-01-01T00:00:00.123Z",
            last_review: "2024-02-29T23:59:59Z",
          },
        },
      ],
      practiceDays: [{ date: "2024-02-29" }],
    });
    expect(revived.cards[0]?.fsrs.due).toBeInstanceOf(Date);
    expect(revived.cards[0]?.fsrs.last_review).toBeInstanceOf(Date);
    expect(revived.practiceDays).toEqual([{ date: "2024-02-29" }]);
  });

  it.each([
    ["non-Z offset", { fsrs: { due: "2026-01-01T00:00:00+07:00" } }],
    ["invalid timestamp day", { fsrs: { due: "2026-02-30T00:00:00Z" } }],
    ["zero timestamp year", { fsrs: { due: "0000-01-01T00:00:00Z" } }],
    ["short timestamp", { fsrs: { due: "2026" } }],
    ["NUL in card back", { back: "answer\u0000" }],
    ["NUL in card text", { front: "hello\u0000" }],
    ["NUL in lesson id", { source: { lessonId: "lesson\u0000-1", sentenceId: "sentence-1" }, id: "lesson\u0000-1:sentence-1" }],
    ["duplicate card id", { cards: [state().cards[0], state().cards[0]] }],
    ["card id mismatch", { id: "other:sentence-1" }],
    ["null cards", { cards: null }],
    ["null practice days", { practiceDays: null }],
    ["null lesson completion", { lessonCompletion: null }],
  ])("rejects %s", (_name, cardOverrides) => {
    const overrides = cardOverrides as Record<string, unknown>;
    const next = "cards" in overrides || "practiceDays" in overrides || "lessonCompletion" in overrides
      ? { ...state(), ...overrides }
      : { ...state(), cards: [{ ...state().cards[0], ...overrides }] };
    expect(() => reviveBackupData(next)).toThrow();
  });

  it("accepts an empty card back", () => {
    expect(() => reviveBackupData({
      ...state(),
      cards: [{ ...state().cards[0], back: "" }],
    })).not.toThrow();
  });

  it("accepts absent and null last_review according to the server contract", () => {
    expect(() => reviveBackupData(state())).not.toThrow();
    expect(() => reviveBackupData({
      ...state(),
      cards: [{ ...state().cards[0], fsrs: { due: "2026-01-01T00:00:00Z", last_review: null } }],
    })).not.toThrow();
  });
});
