import { describe, expect, it } from "vitest";

import { diffWords, normalize } from "./dictation";

describe("normalize", () => {
  it.each([
    ["case", "HELLO World", "hello world"],
    ["punctuation", "Hello, world!", "hello world"],
    ["whitespace", "  hello\n\tworld  ", "hello world"],
    ["apostrophe", "It's", "its"],
    ["hyphen", "sign-off", "sign off"],
    ["exact", "Good morning", "good morning"],
  ])("handles %s", (_name, input, expected) => {
    expect(normalize(input)).toBe(expected);
  });
});

describe("diffWords", () => {
  it("marks identical input all correct", () => {
    expect(diffWords("good morning", "good morning")).toEqual([
      { kind: "correct", word: "good" },
      { kind: "correct", word: "morning" },
    ]);
  });

  it("normalizes case, punctuation and apostrophes away", () => {
    expect(diffWords("its a SIGN off", "It’s a sign-off!")).toEqual([
      { kind: "correct", word: "its" },
      { kind: "correct", word: "a" },
      { kind: "correct", word: "sign" },
      { kind: "correct", word: "off" },
    ]);
  });

  it("reports one omission", () => {
    expect(diffWords("good today", "good morning today")).toEqual([
      { kind: "correct", word: "good" },
      { kind: "missed", word: "morning" },
      { kind: "correct", word: "today" },
    ]);
  });

  it("reports one insertion", () => {
    expect(diffWords("good sunny morning", "good morning")).toEqual([
      { kind: "correct", word: "good" },
      { kind: "extra", typed: "sunny" },
      { kind: "correct", word: "morning" },
    ]);
  });

  it("reports one substitution", () => {
    expect(diffWords("good evening today", "good morning today")).toEqual([
      { kind: "correct", word: "good" },
      { kind: "replaced", word: "morning", typed: "evening" },
      { kind: "correct", word: "today" },
    ]);
  });

  it("marks every reference word missed for empty input", () => {
    expect(diffWords("  ", "See you tomorrow.")).toEqual([
      { kind: "missed", word: "see" },
      { kind: "missed", word: "you" },
      { kind: "missed", word: "tomorrow" },
    ]);
  });

  it("does not mis-pair a repeated word", () => {
    expect(diffWords("the saw the dog", "the cat saw the dog")).toEqual([
      { kind: "correct", word: "the" },
      { kind: "missed", word: "cat" },
      { kind: "correct", word: "saw" },
      { kind: "correct", word: "the" },
      { kind: "correct", word: "dog" },
    ]);
  });

  it("aligns a sentence typed in a different order", () => {
    expect(diffWords("the dog saw the cat", "the cat saw the dog")).toEqual([
      { kind: "correct", word: "the" },
      { kind: "replaced", word: "cat", typed: "dog" },
      { kind: "correct", word: "saw" },
      { kind: "correct", word: "the" },
      { kind: "replaced", word: "dog", typed: "cat" },
    ]);
    expect(diffWords("morning good", "good morning")).toEqual([
      { kind: "replaced", word: "good", typed: "morning" },
      { kind: "replaced", word: "morning", typed: "good" },
    ]);
  });
});
