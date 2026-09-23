import { describe, expect, it } from "vitest";

import { createCard, deleteCard } from "./vocab";
import { newerCard } from "./newerCard";

function card(updatedAt: string, deleted = false) {
  const value = createCard(
    {
      front: "front",
      back: "answer",
      source: { lessonId: "lesson-1", sentenceId: "sentence-1", word: "" },
    },
    new Date(updatedAt),
  );
  return deleted ? deleteCard(value, new Date(updatedAt)) : value;
}

const earlier = "2026-01-02T00:00:00.000Z";
const later = "2026-01-04T00:00:00.000Z";

describe("newerCard", () => {
  it.each([
    ["newer updatedAt wins", card(earlier), card(later), true],
    ["older updatedAt loses", card(later), card(earlier), false],
    ["older live copy never resurrects a tombstone", card(later, true), card(earlier), false],
    ["newer live copy (undo or re-save) replaces a tombstone", card(earlier, true), card(later), true],
    ["equal with an incoming tombstone: tombstone wins", card(later), card(later, true), true],
    ["equal with a stored tombstone: stored kept", card(later, true), card(later), false],
    ["equal live cards: stored kept", card(later), card(later), false],
    ["equal tombstones: stored kept", card(later, true), card(later, true), false],
  ] as const)("%s", (_name, stored, incoming, expected) => {
    expect(newerCard(stored, incoming)).toBe(expected);
  });

  it("compares instants, not strings", () => {
    const stored = card(later);
    expect(newerCard(stored, { ...card(later, true), updatedAt: "2026-01-04T00:00:00Z" })).toBe(true);
  });
});
