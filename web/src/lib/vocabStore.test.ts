import { describe, expect, it } from "vitest";

import { mergeInto } from "./backupStore";
import { deleteCard, Rating, reviewCard } from "./vocab";
import { card as newCard } from "../test/fixtures";
import { dueCards, getAllCards, putCard, restoreTombstone, saveCard, saveReview } from "./vocabStore";

const now = new Date("2026-01-01T00:00:00Z");

describe("vocabulary store", () => {
  it("round-trips FSRS dates through IndexedDB after reopening", async () => {
    const card = newCard("sentence-1", now);
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
    const early = newCard("early", new Date("2025-12-31T23:00:00Z"));
    const late = newCard("late", new Date("2025-01-01T00:00:00Z"));
    const future = newCard("future", new Date("2026-01-02T00:00:00Z"));

    expect(dueCards([early, future, late], now).map((card) => card.id)).toEqual([
      late.id,
      early.id,
    ]);
  });

  it("never selects a deleted card", () => {
    const card = newCard("sentence-1", new Date("2025-12-31T00:00:00Z"));

    expect(dueCards([deleteCard(card, now)], now)).toEqual([]);
  });

  describe("after a history merge at the same updatedAt", () => {
    // Device B reviewed the card 3 times up to Jan 3; this device saved it fresh on Jan 4.
    function history() {
      let card = newCard("sentence-1", new Date("2026-01-01T00:00:00.000Z"));
      for (const day of ["2026-01-01T00:01:00.000Z", "2026-01-02T00:00:00.000Z", "2026-01-03T00:00:00.000Z"]) {
        card = reviewCard(card, Rating.Good, new Date(day));
      }
      return card;
    }

    it("rejects a rating of the pre-merge card and keeps the merged history", async () => {
      await saveCard(newCard("sentence-1", new Date("2026-01-04T00:00:00.000Z")));
      const shown = (await getAllCards())[0]!;
      await mergeInto({ cards: [history()], practiceDays: [], lessonCompletion: [] });
      const merged = (await getAllCards())[0]!;
      expect(merged.updatedAt).toBe(shown.updatedAt);
      expect(merged.fsrs.reps).toBe(3);

      expect(await saveReview(shown, Rating.Good, new Date("2026-01-05T00:00:00.000Z"))).toBe(false);
      expect(await getAllCards()).toEqual([merged]);
    });

    it("rejects restoring a tombstone whose fsrs changed", async () => {
      const tombstone = deleteCard(newCard("sentence-1", new Date("2026-01-04T00:00:00.000Z")), new Date("2026-01-04T01:00:00.000Z"));
      await putCard(tombstone);
      await putCard({ ...tombstone, fsrs: history().fsrs });

      expect(await restoreTombstone(tombstone, new Date("2026-01-05T00:00:00.000Z"))).toBe(false);
      expect((await getAllCards())[0]).toMatchObject({ deletedAt: tombstone.deletedAt, fsrs: { reps: 3 } });
    });
  });
});
