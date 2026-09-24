import { describe, expect, it } from "vitest";

import { mergeCard } from "./mergeCard";
import { card as newCard } from "../test/fixtures";
import {
  capNewCards,
  createCard,
  deleteCard,
  formatInterval,
  GRADES,
  MAX_KEY_BYTES,
  previewIntervals,
  Rating,
  restoreCard,
  reviewCard,
  sentenceCard,
  splitCardBack,
  State,
  wordCardBack,
} from "./vocab";

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

  it("refuses a card whose id is over MAX_KEY_BYTES in UTF-8 bytes", () => {
    const prefix = "lesson-1:sentence-1:";
    const atCap = { ...input, source: { ...input.source, word: "a".repeat(MAX_KEY_BYTES - prefix.length) } };
    expect(createCard(atCap, now).id).toHaveLength(MAX_KEY_BYTES);
    expect(() => createCard({ ...input, source: { ...atCap.source, word: `${atCap.source.word}a` } }, now)).toThrow();
    const multibyte = { ...input, source: { ...input.source, lessonId: "é".repeat(MAX_KEY_BYTES / 2) } };
    expect(() => createCard(multibyte, now)).toThrow();
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

describe("previewIntervals", () => {
  it("previews the due reviewCard gives for each grade", () => {
    let card = newCard();
    while (card.fsrs.state !== State.Review) {
      card = reviewCard(card, Rating.Good, card.fsrs.due);
    }
    for (const subject of [newCard(), card]) {
      const preview = previewIntervals(subject, subject.fsrs.due);
      for (const grade of GRADES) {
        expect(preview[grade]).toEqual(reviewCard(subject, grade, subject.fsrs.due).fsrs.due);
      }
    }
  });

  it("previews at the same clamped time as reviewCard when updatedAt is ahead of now", () => {
    const stored = reviewCard(newCard(), Rating.Good, new Date(now.getTime() + 86_400_000));
    const preview = previewIntervals(stored, now);
    for (const grade of GRADES) {
      expect(preview[grade]).toEqual(reviewCard(stored, grade, now).fsrs.due);
    }
  });

  it("lists the grades from Again to Easy", () => {
    expect(GRADES).toEqual([Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]);
  });
});

describe("formatInterval", () => {
  const MIN = 60_000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  it.each([
    [-5_000, "<1 min"],
    [0, "<1 min"],
    [MIN - 1, "<1 min"],
    [MIN, "1 min"],
    [59 * MIN, "59 min"],
    [59.5 * MIN, "1 h"],
    [HOUR, "1 h"],
    [23 * HOUR, "23 h"],
    [23.5 * HOUR, "1 d"],
    [DAY, "1 d"],
    [29 * DAY, "29 d"],
    [30 * DAY, "1 mo"],
    [45 * DAY, "1.5 mo"],
    [299 * DAY, "10 mo"],
    [335 * DAY, "11 mo"],
    [344 * DAY, "11 mo"],
    [345 * DAY, "1 y"],
    [364 * DAY, "1 y"],
    [365 * DAY, "1 y"],
    [548 * DAY, "1.5 y"],
    [3650 * DAY, "10 y"],
  ])("formats %d ms as %s", (ms, text) => {
    expect(formatInterval(ms)).toBe(text);
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

describe("card backs", () => {
  const wordCard = (lessonId: string, back: string) =>
    createCard({ front: "tea", back, source: { lessonId, sentenceId: "s1", word: "tea" } }, now);
  const savedSentence = (lessonId: string, sentence: { text: string; vi: string; notes?: string }) =>
    createCard(sentenceCard(lessonId, { id: "s1", ...sentence }), now);

  it("splits the Vietnamese back out of what wordCardBack wrote", () => {
    const back = wordCardBack("I like tea.", "Tôi thích trà.");
    expect(splitCardBack(wordCard("greetings-basics", back))).toEqual({
      before: "I like tea. — ",
      vi: "Tôi thích trà.",
      after: "",
    });
  });

  it("finds no Vietnamese in a word card without it or on a user lesson", () => {
    expect(wordCardBack("I like tea.", "")).toBe("I like tea.");
    expect(splitCardBack(wordCard("greetings-basics", "I like tea."))).toBeNull();
    expect(splitCardBack(wordCard("user-1", wordCardBack("I like tea.", "x")))).toBeNull();
  });

  it("backs a sentence card with its Vietnamese, then its notes", () => {
    const card = savedSentence("greetings-basics", { text: "I like tea.", vi: "Tôi thích trà.", notes: "like + noun" });
    expect(card.back).toBe("Tôi thích trà. — like + noun");
    expect(splitCardBack(card)).toEqual({ before: "", vi: "Tôi thích trà.", after: " — like + noun" });
  });

  it("backs a sentence card without notes with its Vietnamese alone", () => {
    const card = savedSentence("greetings-basics", { text: "I like tea.", vi: "Tôi thích trà." });
    expect(card.back).toBe("Tôi thích trà.");
    expect(splitCardBack(card)).toEqual({ before: "", vi: "Tôi thích trà.", after: "" });
  });

  // Library Vietnamese never holds the separator (and is never empty), so it ends at the first one.
  it("keeps notes that hold the separator after the Vietnamese", () => {
    const card = savedSentence("greetings-basics", { text: "I like tea.", vi: "Tôi thích trà.", notes: "a — b" });
    expect(splitCardBack(card)).toEqual({ before: "", vi: "Tôi thích trà.", after: " — a — b" });
  });

  it("backs a user lesson's sentence card with its notes and finds no Vietnamese", () => {
    const card = savedSentence("user-1", { text: "I like tea.", vi: "", notes: "like + noun" });
    expect(card.back).toBe("like + noun");
    expect(splitCardBack(card)).toBeNull();
    expect(savedSentence("user-1", { text: "I like tea.", vi: "" }).back).toBe("");
  });
});
