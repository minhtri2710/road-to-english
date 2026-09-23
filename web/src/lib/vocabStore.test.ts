import { describe, expect, it } from "vitest";

import { createCard, deleteCard } from "./vocab";
import { dueCards, getAllCards, putCard } from "./vocabStore";

const now = new Date("2026-01-01T00:00:00Z");
const input = {
  front: "hello",
  back: "hola",
  source: { lessonId: "lesson-1", sentenceId: "sentence-1", word: "" },
};

describe("vocabulary store", () => {
  it("round-trips FSRS dates through IndexedDB after reopening", async () => {
    const card = createCard(input, now);
    await putCard(card);

    const firstRead = await getAllCards();
    expect(firstRead[0]?.fsrs.due).toBeInstanceOf(Date);
    expect(firstRead[0]?.fsrs.due.getTime()).toBe(card.fsrs.due.getTime());
    expect(firstRead[0]?.fsrs.last_review).toBeUndefined();

    const reopenedRead = await getAllCards();
    expect(reopenedRead[0]?.fsrs.due).toBeInstanceOf(Date);
    expect(reopenedRead[0]?.fsrs.due.getTime()).toBe(card.fsrs.due.getTime());
  });

  it("selects due cards in ascending due order", () => {
    const early = createCard(
      { ...input, source: { ...input.source, sentenceId: "early", word: "" } },
      new Date("2025-12-31T23:00:00Z"),
    );
    const late = createCard(
      { ...input, source: { ...input.source, sentenceId: "late", word: "" } },
      new Date("2025-01-01T00:00:00Z"),
    );
    const future = createCard(
      { ...input, source: { ...input.source, sentenceId: "future", word: "" } },
      new Date("2026-01-02T00:00:00Z"),
    );

    expect(dueCards([early, future, late], now).map((card) => card.id)).toEqual([
      late.id,
      early.id,
    ]);
  });

  it("never selects a deleted card", () => {
    const card = createCard(input, new Date("2025-12-31T00:00:00Z"));

    expect(dueCards([deleteCard(card, now)], now)).toEqual([]);
  });
});
