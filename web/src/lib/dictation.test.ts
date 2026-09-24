import { describe, expect, it } from "vitest";

import { blankFor, blankMatches, diffWords, splitWords } from "./dictation";

describe("normalization", () => {
  it.each([
    ["case", "HELLO World", "hello world"],
    ["punctuation", "Hello, world!", "hello world"],
    ["whitespace", "  hello\n\tworld  ", "hello world"],
    ["apostrophe", "It's", "its"],
    ["hyphen", "sign-off", "sign off"],
    ["exact", "Good morning", "good morning"],
  ])("handles %s", (_name, input, expected) => {
    const words = diffWords(input, input).map((part) => (part.kind === "correct" ? part.word : ""));
    expect(words.join(" ")).toBe(expected);
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

describe("blankFor", () => {
  it.each([
    ["longest word", "I like apples a lot", 5, "apples"],
    ["earliest on a tie", "cats and dogs", 1, "cats"],
    ["apostrophe", "What's up?", 1, "whats"],
    ["punctuation", "Hi, everyone!", 3, "everyone"],
    ["seed: greeting", "Good morning, how are you today?", 3, "morning"],
    ["seed: introduction", "I'm from Vietnam, and I live in Hanoi.", 5, "vietnam"],
    ["seed: request", "Sorry, could you say that again?", 1, "sorry"],
    ["compound", "I wear a T-shirt and shorts.", 7, "t-shirt"],
  ])("picks the %s", (_name, text, index, answer) => {
    const blank = blankFor(text);
    expect(blank.index).toBe(index);
    expect(blank.answer).toBe(answer);
    expect(blank.parts.join("")).toBe(text);
  });

  it("is deterministic", () => {
    expect(blankFor("Thanks a lot for your help.")).toEqual(
      blankFor("Thanks a lot for your help."),
    );
  });

  it.each(["", "...", " - ! "])("returns -1 for no-word text %j", (text) => {
    expect(blankFor(text).index).toBe(-1);
  });
});

describe("splitWords", () => {
  it.each([
    ["I wear a T-shirt and shorts.", ["", "I", " ", "wear", " ", "a", " ", "T-shirt", " ", "and", " ", "shorts", "."]],
    ["twenty-five", ["", "twenty-five", ""]],
    ["a - b", ["", "a", " - ", "b", ""]],
    ["word-", ["", "word", "-"]],
  ])("splits %j", (text, parts) => {
    expect(splitWords(text)).toEqual(parts);
  });
});

describe("blankMatches", () => {
  it.each(["t-shirt", "T-shirt", "t shirt", " T-Shirt "])("accepts %j for t-shirt", (typed) => {
    expect(blankMatches(typed, "t-shirt")).toBe(true);
  });

  it.each(["tshirt", "shirt", ""])("rejects %j for t-shirt", (typed) => {
    expect(blankMatches(typed, "t-shirt")).toBe(false);
  });

  it("accepts a typed apostrophe for an apostrophe answer", () => {
    expect(blankMatches("What's", blankFor("What's up?").answer)).toBe(true);
  });
});

describe("number equivalence", () => {
  const allCorrect = (typed: string, reference: string) =>
    diffWords(typed, reference).every((d) => d.kind === "correct");

  it.each([
    ["6:30", "six thirty"],
    ["12:05", "twelve oh five"],
    ["6:09", "six oh nine"],
    ["7 o'clock", "seven o'clock"],
    ["7:00", "seven o'clock"],
    ["25", "twenty-five"],
    ["0912", "zero nine one two"],
    ["half past 3", "half past three"],
    ["12", "twelve"],
    ["305", "three hundred five"],
  ])("matches %s to %s", (digits, words) => {
    expect(allCorrect(digits, words)).toBe(true);
    expect(allCorrect(words, digits)).toBe(true);
  });

  it("spells time minutes 01-09 as oh and leaves other numbers alone", () => {
    expect(allCorrect("12:05", "twelve zero five")).toBe(false);
    expect(allCorrect("7:00", "seven oh")).toBe(false);
    expect(allCorrect("0912", "zero nine one two")).toBe(true);
    expect(allCorrect("0912", "oh nine one two")).toBe(false);
  });

  it("leaves 1000 and up as digits", () => {
    expect(diffWords("2026", "2026")).toEqual([{ kind: "correct", word: "2026" }]);
    expect(allCorrect("2026", "two thousand twenty six")).toBe(false);
  });

  it("still marks a wrong number and a non-number word", () => {
    expect(diffWords("I get up at 6:45", "I get up at six thirty.").slice(-3)).toEqual([
      { kind: "correct", word: "six" },
      { kind: "replaced", word: "thirty", typed: "forty" },
      { kind: "extra", typed: "five" },
    ]);
    expect(diffWords("cat", "dog")).toEqual([{ kind: "replaced", word: "dog", typed: "cat" }]);
  });

  it("scores a recognizer transcript with digits all correct", () => {
    expect(allCorrect("I get up at 6:30", "I get up at six thirty.")).toBe(true);
  });

  it("applies to the blank check", () => {
    expect(blankMatches("7", "seven")).toBe(true);
    expect(blankMatches("8", "seven")).toBe(false);
  });
});
