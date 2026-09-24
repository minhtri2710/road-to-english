import { describe, expect, it } from "vitest";

import { deleteCard, reviewCard, Rating, type VocabCard } from "./vocab";
import { mergeCard } from "./mergeCard";
import { card } from "../test/fixtures";

const earlier = "2026-01-02T00:00:00.000Z";
const later = "2026-01-04T00:00:00.000Z";

function fresh(front: string, updatedAt: string): VocabCard {
  return card("sentence-1", new Date(updatedAt), { front });
}

// `reps` Good reviews, the last one at `updatedAt`.
function reviewed(front: string, updatedAt: string, reps = 3): VocabCard {
  let card = fresh(front, "2026-01-01T00:00:00.000Z");
  for (let index = 1; index < reps; index += 1) {
    card = reviewCard(card, Rating.Good, new Date(Date.parse(card.updatedAt) + 60_000));
  }
  return reviewCard(card, Rating.Good, new Date(updatedAt));
}

function tombstone(card: VocabCard, deletedAt: string): VocabCard {
  return deleteCard(card, new Date(deletedAt));
}

// Mirrors api storage_test.go TestCardUpsertMergeRule case for case.
// symmetric is false only for the equal-time both-live or both-tombstone tie, where the stored copy wins.
const cases: [string, VocabCard, VocabCard, VocabCard, boolean][] = [
  ["newer updatedAt wins", reviewed("a", earlier), reviewed("b", later), reviewed("b", later), true],
  ["older updatedAt loses", reviewed("a", later), reviewed("b", earlier), reviewed("a", later), true],
  ["older live copy never resurrects a tombstone", tombstone(reviewed("a", earlier), later), reviewed("b", earlier), tombstone(reviewed("a", earlier), later), true],
  ["newer live copy replaces a tombstone", tombstone(reviewed("a", earlier), earlier), reviewed("b", later), reviewed("b", later), true],
  ["equal time: incoming tombstone wins", reviewed("a", later), tombstone(reviewed("b", earlier), later), tombstone(reviewed("b", earlier), later), true],
  ["equal time: stored tombstone kept", tombstone(reviewed("a", earlier), later), reviewed("b", later), tombstone(reviewed("a", earlier), later), true],
  ["equal live cards: stored kept", reviewed("a", later), fresh("b", later), reviewed("a", later), false],
  ["equal tombstones: stored kept", tombstone(reviewed("a", earlier), later), tombstone(reviewed("b", earlier, 5), later), tombstone(reviewed("a", earlier), later), false],
  ["newer fresh save over reviewed history keeps the history", reviewed("a", earlier), fresh("b", later), { ...fresh("b", later), fsrs: reviewed("a", earlier).fsrs }, true],
  ["older reviewed copy gives its history to a newer fresh save", fresh("a", later), reviewed("b", earlier), { ...fresh("a", later), fsrs: reviewed("b", earlier).fsrs }, true],
  ["older fresh save loses", reviewed("a", later), fresh("b", earlier), reviewed("a", later), true],
  ["reviewed beats reviewed by time", reviewed("a", earlier, 5), reviewed("b", later), reviewed("b", later), true],
  ["tombstone with history + newer fresh save: live, history kept", tombstone(reviewed("a", earlier), earlier), fresh("b", later), { ...fresh("b", later), fsrs: reviewed("a", earlier).fsrs }, true],
];

describe("mergeCard", () => {
  it.each(cases)("%s", (_name, stored, incoming, want) => {
    expect(mergeCard(stored, incoming)).toEqual(want);
  });

  it.each(cases.filter(([, , , , symmetric]) => symmetric))("symmetric: %s", (_name, stored, incoming, want) => {
    expect(mergeCard(incoming, stored)).toEqual(want);
  });

  it("compares instants, not strings", () => {
    const incoming = { ...tombstone(reviewed("b", earlier), later), updatedAt: "2026-01-04T00:00:00Z" };
    expect(mergeCard(reviewed("a", later), incoming)).toBe(incoming);
  });
});
