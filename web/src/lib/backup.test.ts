import { describe, expect, it } from "vitest";

import { backupFileName, exportData, importData } from "./backup";
import { createCard } from "./vocab";

const now = new Date("2026-01-05T00:00:00.000Z");

function backupState() {
  const first = createCard(
    {
      front: "hello",
      back: "hola",
      source: { lessonId: "lesson-1", sentenceId: "sentence-1" },
    },
    now,
  );
  const second = createCard(
    {
      front: "goodbye",
      back: "adiós",
      source: { lessonId: "lesson-2", sentenceId: "sentence-2" },
    },
    now,
  );
  const lastReview = new Date("2026-01-04T12:00:00.000Z");
  second.fsrs.last_review = lastReview;

  return {
    cards: [first, second],
    practiceDays: [{ date: "2026-01-05" }],
    lessonCompletion: [{ lessonId: "lesson-1" }],
  };
}

describe("backup", () => {
  it("round-trips all stores and revives FSRS dates", () => {
    const state = backupState();
    const imported = importData(exportData(state, new Date(2026, 0, 5)));

    expect(imported.cards).toHaveLength(state.cards.length);
    expect(imported.cards[0]?.fsrs.due).toBeInstanceOf(Date);
    expect(imported.cards[0]?.fsrs.due.getTime()).toBe(state.cards[0]?.fsrs.due.getTime());
    expect(imported.cards[1]?.fsrs.last_review).toBeInstanceOf(Date);
    expect(imported.cards[1]?.fsrs.last_review?.getTime()).toBe(
      state.cards[1]?.fsrs.last_review?.getTime(),
    );
    expect(JSON.parse(JSON.stringify(imported.cards))).toEqual(
      JSON.parse(JSON.stringify(state.cards)),
    );
    expect(imported.practiceDays).toEqual(state.practiceDays);
    expect(imported.lessonCompletion).toEqual(state.lessonCompletion);
    expect(JSON.parse(exportData(state, new Date(2026, 0, 5))).exportedAt).toBeDefined();
  });

  it.each([
    ["version", { ...backupState(), version: 2 }],
    ["missing store", { version: 1, cards: backupState().cards, practiceDays: backupState().practiceDays }],
    ["cards not array", { ...backupState(), cards: {} }],
    [
      "invalid due",
      {
        ...backupState(),
        cards: [{ ...backupState().cards[0], fsrs: { ...backupState().cards[0]?.fsrs, due: "not-a-date" } }],
      },
    ],
    ["malformed practice day", { ...backupState(), practiceDays: [{ date: "2026-1-5" }] }],
  ])("rejects %s", (_name, value) => {
    expect(() => importData(JSON.stringify(value))).toThrow();
  });

  it("uses the injected date in the file name", () => {
    expect(backupFileName(new Date(2026, 0, 5))).toContain("2026-01-05");
  });
});
