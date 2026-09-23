import { describe, expect, it } from "vitest";

import { createCard } from "./vocab";
import { newerCard } from "./newerCard";

const base = new Date("2026-01-01T00:00:00Z");

function card(front: string, lastReview?: string) {
  const value = createCard(
    {
      front,
      back: "answer",
      source: { lessonId: "lesson-1", sentenceId: "sentence-1", word: "" },
    },
    base,
  );
  if (lastReview !== undefined) {
    value.fsrs.last_review = new Date(lastReview);
  }
  return value;
}

describe("newerCard", () => {
  it.each([
    ["TestCardUpsertOverwrites", "2026-01-02T00:00:00Z", "2026-01-04T00:00:00Z", true],
    ["TestCardUpsertOlderDoesNotRegress", "2026-01-04T00:00:00Z", "2026-01-02T00:00:00Z", false],
    ["TestCardUpsertEqualIsNoOp", "2026-01-04T00:00:00Z", "2026-01-04T00:00:00Z", false],
    ["TestUnreviewedCardDoesNotOverwriteReviewedCard", "2026-01-04T00:00:00Z", undefined, false],
    ["TestReviewedCardOverwritesNeverReviewedCard", undefined, "2026-01-04T00:00:00Z", true],
    ["TestNeverReviewedCardsWithSameIDDoNotUpdateEachOther", undefined, undefined, false],
  ] as const)("mirrors %s", (_name, aReview, bReview, expected) => {
    expect(newerCard(card("a", aReview), card("b", bReview))).toBe(expected);
  });
});
