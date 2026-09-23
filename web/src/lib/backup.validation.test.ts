import { describe, expect, it } from "vitest";

import { isValidDayKey, isValidTimestamp, reviveSyncState } from "./backup";

const fsrsFields = {
  stability: 2.5,
  difficulty: 4.2,
  elapsed_days: 1,
  scheduled_days: 2,
  learning_steps: 0,
  reps: 3,
  lapses: 0,
  state: 2,
};

function state(overrides: Record<string, unknown> = {}) {
  return {
    cards: [
      {
        id: "lesson-1:sentence-1",
        front: "hello",
        back: "answer",
        source: { lessonId: "lesson-1", sentenceId: "sentence-1", word: "" },
        fsrs: { ...fsrsFields, due: "2026-01-01T00:00:00Z" },
        updatedAt: "2026-01-01T00:00:00.000Z",
        deletedAt: null,
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
    ["0001-01-01T00:00:00.5Z", true],
    ["0001-01-01T00:00:00.123Z", true],
    ["2026-01-01T00:00:00,5Z", false],
    ["2026-01-01T00:00:00.1234Z", false],
    ["2026-01-01T00:00:00.Z", false],
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
    const revived = reviveSyncState({
      ...state(),
      cards: [
        {
          ...state().cards[0],
          fsrs: {
            ...fsrsFields,
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
    ["non-Z offset", { fsrs: { ...fsrsFields, due: "2026-01-01T00:00:00+07:00" } }],
    ["invalid timestamp day", { fsrs: { ...fsrsFields, due: "2026-02-30T00:00:00Z" } }],
    ["zero timestamp year", { fsrs: { ...fsrsFields, due: "0000-01-01T00:00:00Z" } }],
    ["short timestamp", { fsrs: { ...fsrsFields, due: "2026" } }],
    ["NUL in card back", { back: "answer\u0000" }],
    ["NUL in card text", { front: "hello\u0000" }],
    ["NUL in lesson id", { source: { lessonId: "lesson\u0000-1", sentenceId: "sentence-1", word: "" }, id: "lesson\u0000-1:sentence-1" }],
    ["duplicate card id", { cards: [state().cards[0], state().cards[0]] }],
    ["card id mismatch", { id: "other:sentence-1" }],
    ["missing word", { source: { lessonId: "lesson-1", sentenceId: "sentence-1" } }],
    ["word card with sentence id", { source: { lessonId: "lesson-1", sentenceId: "sentence-1", word: "hello" } }],
    ["word with colon", { source: { lessonId: "lesson-1", sentenceId: "sentence-1", word: "a:b" }, id: "lesson-1:sentence-1:a:b" }],
    ["uppercase word", { source: { lessonId: "lesson-1", sentenceId: "sentence-1", word: "Hello" }, id: "lesson-1:sentence-1:Hello" }],
    ["missing updatedAt", { updatedAt: undefined }],
    ["null updatedAt", { updatedAt: null }],
    ["invalid updatedAt", { updatedAt: "2026-01-01T00:00:00+07:00" }],
    ["missing deletedAt", { deletedAt: undefined }],
    ["invalid deletedAt", { deletedAt: "yesterday" }],
    ["null cards", { cards: null }],
    ["null practice days", { practiceDays: null }],
    ["null lesson completion", { lessonCompletion: null }],
  ])("rejects %s", (_name, cardOverrides) => {
    const overrides = cardOverrides as Record<string, unknown>;
    const next = "cards" in overrides || "practiceDays" in overrides || "lessonCompletion" in overrides
      ? { ...state(), ...overrides }
      : { ...state(), cards: [{ ...state().cards[0], ...overrides }] };
    expect(() => reviveSyncState(next)).toThrow();
  });

  const invalidFsrs: [keyof typeof fsrsFields, unknown[]][] = [
    ["stability", [undefined, -0.5, null, "1", Infinity, NaN]],
    ["difficulty", [undefined, -1, null, true]],
    ["elapsed_days", [undefined, -1, 1.5, null]],
    ["scheduled_days", [undefined, -1, 0.5, "2"]],
    ["learning_steps", [undefined, -1, 1.25, null]],
    ["reps", [undefined, -1, 1.5, 9007199254740992, null]],
    ["lapses", [undefined, -1, 2.5, []]],
    ["state", [undefined, -1, 4, 1.5, null]],
  ];
  it.each(invalidFsrs.flatMap(([key, values]) => values.map((value) => [key, value] as const)))(
    "rejects fsrs %s = %s",
    (key, value) => {
      const fsrs: Record<string, unknown> = { ...fsrsFields, due: "2026-01-01T00:00:00Z" };
      if (value === undefined) {
        delete fsrs[key];
      } else {
        fsrs[key] = value;
      }
      expect(() => reviveSyncState({ ...state(), cards: [{ ...state().cards[0], fsrs }] })).toThrow(
        "Invalid card at index 0.",
      );
    },
  );

  it.each([
    ["state", 3],
    ["reps", Number.MAX_SAFE_INTEGER],
    ["stability", 0],
    ["difficulty", 10.75],
  ] as const)("accepts fsrs %s = %s", (key, value) => {
    const fsrs = { ...fsrsFields, due: "2026-01-01T00:00:00Z", [key]: value };
    expect(() => reviveSyncState({ ...state(), cards: [{ ...state().cards[0], fsrs }] })).not.toThrow();
  });

  it("accepts sentence and word cards", () => {
    expect(() => reviveSyncState({
      ...state(),
      cards: [
        state().cards[0],
        {
          ...state().cards[0],
          id: "lesson-1:sentence-1:hello",
          source: { lessonId: "lesson-1", sentenceId: "sentence-1", word: "hello" },
        },
        {
          ...state().cards[0],
          id: "lesson-1:sentence-1:t-shirt",
          source: { lessonId: "lesson-1", sentenceId: "sentence-1", word: "t-shirt" },
        },
      ],
    })).not.toThrow();
  });

  it("revives only the sync stores, never user lessons", () => {
    expect(Object.keys(reviveSyncState({ ...state(), userLessons: [] })).sort()).toEqual([
      "cards",
      "lessonCompletion",
      "practiceDays",
    ]);
  });

  it("accepts live and tombstone cards", () => {
    const revived = reviveSyncState({
      ...state(),
      cards: [
        state().cards[0],
        {
          ...state().cards[0],
          id: "lesson-1:sentence-1:hello",
          source: { lessonId: "lesson-1", sentenceId: "sentence-1", word: "hello" },
          deletedAt: "2026-01-02T00:00:00.000Z",
        },
      ],
    });
    expect(revived.cards.map((card) => card.deletedAt)).toEqual([null, "2026-01-02T00:00:00.000Z"]);
  });

  it("accepts an empty card back", () => {
    expect(() => reviveSyncState({
      ...state(),
      cards: [{ ...state().cards[0], back: "" }],
    })).not.toThrow();
  });

  it("accepts absent and null last_review according to the server contract", () => {
    expect(() => reviveSyncState(state())).not.toThrow();
    expect(() => reviveSyncState({
      ...state(),
      cards: [{ ...state().cards[0], fsrs: { ...fsrsFields, due: "2026-01-01T00:00:00Z", last_review: null } }],
    })).not.toThrow();
  });
});
