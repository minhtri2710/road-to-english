import { describe, expect, it } from "vitest";

import { capNewCards, createCard, deleteCard, Rating, restoreCard, reviewCard, State } from "./vocab";

const now = new Date("2026-01-01T00:00:00Z");
const input = {
  front: "hello",
  back: "hola",
  source: { lessonId: "lesson-1", sentenceId: "sentence-1", word: "" },
};

function newCard() {
  return createCard(input, now);
}

describe("vocabulary cards", () => {
  it("creates a new FSRS card", () => {
    const card = newCard();

    expect(card.fsrs.state).toBe(State.New);
    expect(card.fsrs.due.getTime()).toBe(now.getTime());
    expect(card.fsrs.reps).toBe(0);
    expect(card.fsrs.lapses).toBe(0);
    expect(card.updatedAt).toBe(now.toISOString());
    expect(card.deletedAt).toBeNull();
  });

  it("uses the lesson and sentence as the deterministic card id", () => {
    expect(newCard().id).toBe("lesson-1:sentence-1");
    expect(createCard(input, now).id).toBe(newCard().id);
  });

  it("appends the word to a word card id", () => {
    const card = createCard(
      { ...input, source: { ...input.source, word: "hello" } },
      now,
    );
    expect(card.id).toBe("lesson-1:sentence-1:hello");
    expect(card.source.word).toBe("hello");
  });

  it("rejects a word that is not a single normalized token", () => {
    for (const word of ["Hello", "a:b", "a b"]) {
      expect(() => createCard({ ...input, source: { ...input.source, word } }, now)).toThrow();
    }
  });

  it("schedules a Good review after now", () => {
    const card = reviewCard(newCard(), Rating.Good, now);

    expect(card.fsrs.state).not.toBe(State.New);
    expect(card.fsrs.due.getTime()).toBeGreaterThan(now.getTime());
    expect(card.fsrs.reps).toBe(1);
    expect(card.fsrs.last_review?.getTime()).toBe(now.getTime());
  });

  it("stamps updatedAt on review and keeps the card live", () => {
    const later = new Date("2026-01-03T00:00:00Z");
    const card = reviewCard(newCard(), Rating.Good, later);

    expect(card.updatedAt).toBe(later.toISOString());
    expect(card.deletedAt).toBeNull();
  });

  it("stamps delete and restore, and restore keeps the exact FSRS state", () => {
    const reviewed = reviewCard(newCard(), Rating.Good, now);
    const deletedAt = new Date("2026-01-02T00:00:00Z");
    const restoredAt = new Date("2026-01-03T00:00:00Z");
    const deleted = deleteCard(reviewed, deletedAt);
    const restored = restoreCard(reviewed, restoredAt);

    expect(deleted).toEqual({ ...reviewed, updatedAt: deletedAt.toISOString(), deletedAt: deletedAt.toISOString() });
    expect(restored).toEqual({ ...reviewed, updatedAt: restoredAt.toISOString(), deletedAt: null });
  });

  it("orders review grades from Easy to Again", () => {
    const card = newCard();
    const easy = reviewCard(card, Rating.Easy, now);
    const good = reviewCard(card, Rating.Good, now);
    const hard = reviewCard(card, Rating.Hard, now);
    const again = reviewCard(card, Rating.Again, now);

    expect(easy.fsrs.due.getTime()).toBeGreaterThanOrEqual(good.fsrs.due.getTime());
    expect(good.fsrs.due.getTime()).toBeGreaterThanOrEqual(hard.fsrs.due.getTime());
    expect(hard.fsrs.due.getTime()).toBeGreaterThanOrEqual(again.fsrs.due.getTime());
  });

  it("moves a reviewed card to Relearning after a lapse", () => {
    let card = newCard();

    while (card.fsrs.state !== State.Review) {
      card = reviewCard(card, Rating.Good, card.fsrs.due);
    }

    const dueDate = card.fsrs.due;
    const lapsed = reviewCard(card, Rating.Again, dueDate);

    expect(lapsed.fsrs.lapses).toBe(1);
    expect(lapsed.fsrs.state).toBe(State.Relearning);
  });

  it("does not mutate the input card", () => {
    const card = newCard();
    const snapshot = structuredClone(card);

    reviewCard(card, Rating.Good, now);

    expect(card).toEqual(snapshot);
  });

  it("is deterministic for identical inputs", () => {
    const card = newCard();

    expect(reviewCard(card, Rating.Good, now)).toEqual(
      reviewCard(card, Rating.Good, now),
    );
  });
});

describe("capNewCards", () => {
  const newCards = Array.from({ length: 25 }, (_, index) =>
    createCard(
      { ...input, source: { ...input.source, sentenceId: `new-${index}` } },
      now,
    ),
  );
  const reviewCards = [0, 1, 2].map((index) =>
    reviewCard(
      createCard({ ...input, source: { ...input.source, sentenceId: `review-${index}` } }, now),
      Rating.Good,
      now,
    ),
  );
  // Review cards interleaved with New cards, in due order.
  const due = [reviewCards[0], ...newCards.slice(0, 10), reviewCards[1], ...newCards.slice(10), reviewCards[2]];
  const ids = (cards: typeof due) => cards.map((card) => card.id);
  const newCount = (cards: typeof due) =>
    cards.filter((card) => card.fsrs.state === State.New).length;

  it("keeps 20 New cards and every review card when none were introduced", () => {
    const capped = capNewCards(due, 0);

    expect(newCount(capped)).toBe(20);
    expect(capped).toHaveLength(23);
    expect(ids(capped)).toEqual(
      ids(due.filter((card) => card.fsrs.state !== State.New || newCards.slice(0, 20).includes(card))),
    );
  });

  it("keeps only the first 2 New cards after 18 were introduced", () => {
    const capped = capNewCards(due, 18);

    expect(ids(capped)).toEqual([
      reviewCards[0].id,
      newCards[0].id,
      newCards[1].id,
      reviewCards[1].id,
      reviewCards[2].id,
    ]);
  });

  it("keeps no New cards past the limit but all review cards", () => {
    expect(ids(capNewCards(due, 25))).toEqual(ids(reviewCards));
  });
});
