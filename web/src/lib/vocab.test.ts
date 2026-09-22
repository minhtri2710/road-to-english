import { describe, expect, it } from "vitest";

import { createCard, Rating, reviewCard, State } from "./vocab";

const now = new Date("2026-01-01T00:00:00Z");
const input = {
  front: "hello",
  back: "hola",
  source: { lessonId: "lesson-1", sentenceId: "sentence-1" },
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
  });

  it("schedules a Good review after now", () => {
    const card = reviewCard(newCard(), Rating.Good, now);

    expect(card.fsrs.state).not.toBe(State.New);
    expect(card.fsrs.due.getTime()).toBeGreaterThan(now.getTime());
    expect(card.fsrs.reps).toBe(1);
    expect(card.fsrs.last_review?.getTime()).toBe(now.getTime());
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
