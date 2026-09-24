import { describe, expect, it } from "vitest";

import { mergeCard } from "./mergeCard";
import { card as newCard } from "../test/fixtures";
import { capNewCards, cardWord, createCard, isCardWord, deleteCard, Rating, restoreCard, reviewCard, splitCardBack, State, wordCardBack } from "./vocab";

const now = new Date("2026-01-01T00:00:00Z");
const input = {
  front: "hello",
  back: "hola",
  source: { lessonId: "lesson-1", sentenceId: "sentence-1", word: "" },
};

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

  it("appends a hyphenated word to a word card id", () => {
    const card = createCard({ ...input, source: { ...input.source, word: "t-shirt" } }, now);
    expect(card.id).toBe("lesson-1:sentence-1:t-shirt");
  });

  it("rejects a word that is not a card word", () => {
    for (const word of ["Hello", "a:b", "a b", "-a", "a--b"]) {
      expect(() => createCard({ ...input, source: { ...input.source, word } }, now)).toThrow();
    }
  });

  it("schedules a Good review after now", () => {
    const at = new Date(now.getTime() + 60_000);
    const card = reviewCard(newCard(), Rating.Good, at);

    expect(card.fsrs.state).not.toBe(State.New);
    expect(card.fsrs.due.getTime()).toBeGreaterThan(at.getTime());
    expect(card.fsrs.reps).toBe(1);
    expect(card.fsrs.last_review?.getTime()).toBe(at.getTime());
  });

  it("rates just after the stored copy when this device's clock is behind it", () => {
    const stored = reviewCard(newCard(), Rating.Good, new Date(now.getTime() + 86_400_000));
    expect(stored.updatedAt).toBe(stored.fsrs.last_review?.toISOString());
    const rated = reviewCard(stored, Rating.Good, now);

    expect(Date.parse(rated.updatedAt)).toBeGreaterThan(Date.parse(stored.updatedAt));
    expect(rated.fsrs.last_review!.getTime()).toBeGreaterThanOrEqual(stored.fsrs.last_review!.getTime());
    expect(rated.fsrs.due.getTime()).toBeGreaterThanOrEqual(rated.fsrs.last_review!.getTime());
    expect(rated.fsrs.reps).toBe(2);
    expect(mergeCard(stored, rated)).toBe(rated);
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
    newCard(`new-${index}`, now),
  );
  const reviewCards = [0, 1, 2].map((index) =>
    reviewCard(
      newCard(`review-${index}`, now),
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

describe("card words", () => {
  it.each(["t-shirt", "twenty-five", "well-known", "a", "dont"])("accepts %j", (word) => {
    expect(isCardWord(word)).toBe(true);
  });

  it.each(["-a", "a-", "a--b", "a b", "", "T-shirt", "Hello"])("rejects %j", (word) => {
    expect(isCardWord(word)).toBe(false);
  });

  it.each([
    ["T-shirt", "t-shirt"],
    ["don't", "dont"],
    ["It's", "its"],
    ["It’s", "its"],
  ])("derives %j as %j", (part, word) => {
    expect(cardWord(part)).toBe(word);
  });
});

describe("word card backs", () => {
  const wordCard = (lessonId: string, back: string) =>
    createCard({ front: "tea", back, source: { lessonId, sentenceId: "s1", word: "tea" } }, now);

  it("splits the Vietnamese back out of what wordCardBack wrote", () => {
    const back = wordCardBack("I like tea.", "Tôi thích trà.");
    expect(splitCardBack(wordCard("greetings-basics", back))).toEqual({ sentence: "I like tea.", vi: "Tôi thích trà." });
  });

  it("finds no Vietnamese without it, on a user lesson, or on a sentence card", () => {
    expect(wordCardBack("I like tea.", "")).toBe("I like tea.");
    expect(splitCardBack(wordCard("greetings-basics", "I like tea."))).toBeNull();
    expect(splitCardBack(wordCard("user-1", wordCardBack("I like tea.", "x")))).toBeNull();
    expect(splitCardBack(createCard({ ...input, back: wordCardBack("a", "b") }, now))).toBeNull();
  });
});
