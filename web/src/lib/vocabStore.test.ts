import { describe, expect, it } from "vitest";

import { mergeInto, replaceAll } from "./backupStore";
import { withDb } from "./db";
import type { VocabCard } from "./vocab";
import { deleteCard, Rating, reviewCard } from "./vocab";
import { card as newCard } from "../test/fixtures";
import { dueCards, getAllCards, putCard, restoreTombstone, saveCard, saveReview } from "./vocabStore";

const now = new Date("2026-01-01T00:00:00Z");
const SYNC_EPOCH = "epoch-1";

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
      await mergeInto({ cards: [history()], practiceDays: [], lessonCompletion: [], syncEpoch: SYNC_EPOCH }, []);
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

// W1: every local write stores the card dirty, including over a clean synced copy.
describe("dirty flag on local writes", () => {
  const stored = () => withDb((db) => db.getAll("cards"));
  // Stores `card` as a clean synced copy.
  const synced = (card: VocabCard) => mergeInto({ cards: [card], practiceDays: [], lessonCompletion: [], syncEpoch: SYNC_EPOCH }, []);

  it.each<[string, (card: VocabCard) => Promise<unknown>]>([
    ["putCard", (card) => putCard({ ...card, front: "edited" })],
    ["saveCard", (card) => saveCard({ ...card, updatedAt: "2026-01-02T00:00:00.000Z" })],
    ["saveReview", (card) => saveReview(card, Rating.Good, new Date("2026-01-02T00:00:00Z"))],
  ])("%s stores dirty", async (_name, write) => {
    const card = newCard("sentence-1", now);
    await synced(card);
    expect((await stored())[0]?.dirty).toBe(false);
    await write(card);
    expect((await stored())[0]?.dirty).toBe(true);
  });

  it("restoreTombstone stores dirty", async () => {
    const tombstone = deleteCard(newCard("sentence-1", now), new Date("2026-01-02T00:00:00Z"));
    await synced(tombstone);
    expect(await restoreTombstone(tombstone, new Date("2026-01-03T00:00:00Z"))).toBe(true);
    expect(await stored()).toEqual([expect.objectContaining({ deletedAt: null, dirty: true })]);
  });

  it("replaceAll stores every imported card dirty", async () => {
    await synced(newCard("sentence-1", now));
    await replaceAll({ cards: [newCard("sentence-1", now), newCard("sentence-2", now)], practiceDays: [], lessonCompletion: [], userLessons: [] });
    expect((await stored()).map(({ dirty }) => dirty)).toEqual([true, true]);
  });

  // W2: readers the UI uses return plain cards.
  it("getAllCards returns cards without dirty", async () => {
    await putCard(newCard("sentence-1", now));
    expect(Object.keys((await getAllCards())[0]!)).not.toContain("dirty");
  });
});
