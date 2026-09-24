import { describe, expect, it } from "vitest";

import { blankFor, blankMatches, diffWords, endingHints, hintFor, splitWords, wordBank } from "./dictation";

describe("normalization", () => {
  it.each([
    ["case", "HELLO World", "hello world"],
    ["punctuation", "Hello, world!", "hello world"],
    ["whitespace", "  hello\n\tworld  ", "hello world"],
    ["apostrophe", "It's", "its"],
    ["hyphen", "sign-off", "sign off"],
    ["exact", "Good morning", "good morning"],
  ])("handles %s", (_name, input, expected) => {
    const words = diffWords(input, expected).map((part) => (part.kind === "correct" ? part.word : ""));
    expect(words.join(" ")).toBe(expected);
  });
});

describe("diffWords", () => {
  it("marks identical input all correct", () => {
    expect(diffWords("good morning", "good morning")).toEqual([
      { kind: "correct", word: "good", written: "good" },
      { kind: "correct", word: "morning", written: "morning" },
    ]);
  });

  it("keeps the lesson's own word on reference entries and the normalized typed token", () => {
    expect(diffWords("johns book", "“John's book.”")).toEqual([
      { kind: "correct", word: "John's", written: "John's" },
      { kind: "correct", word: "book", written: "book" },
    ]);
    expect(diffWords("Its thor", "It’s there")).toEqual([
      { kind: "correct", word: "It’s", written: "It’s" },
      { kind: "replaced", word: "there", written: "there", typed: "thor" },
    ]);
  });

  it("normalizes case, punctuation and apostrophes away", () => {
    expect(diffWords("its a SIGN off", "It’s a sign-off!")).toEqual([
      { kind: "correct", word: "It’s", written: "It’s" },
      { kind: "correct", word: "a", written: "a" },
      { kind: "correct", word: "sign", written: "sign-off" },
      { kind: "correct", word: "off", written: "sign-off" },
    ]);
  });

  it("reports one omission", () => {
    expect(diffWords("good today", "good morning today")).toEqual([
      { kind: "correct", word: "good", written: "good" },
      { kind: "missed", word: "morning", written: "morning" },
      { kind: "correct", word: "today", written: "today" },
    ]);
  });

  it("reports one insertion", () => {
    expect(diffWords("good sunny morning", "good morning")).toEqual([
      { kind: "correct", word: "good", written: "good" },
      { kind: "extra", typed: "sunny" },
      { kind: "correct", word: "morning", written: "morning" },
    ]);
  });

  it("reports one substitution", () => {
    expect(diffWords("good evening today", "good morning today")).toEqual([
      { kind: "correct", word: "good", written: "good" },
      { kind: "replaced", word: "morning", written: "morning", typed: "evening" },
      { kind: "correct", word: "today", written: "today" },
    ]);
  });

  it("marks every reference word missed for empty input", () => {
    expect(diffWords("  ", "See you tomorrow.")).toEqual([
      { kind: "missed", word: "See", written: "See" },
      { kind: "missed", word: "you", written: "you" },
      { kind: "missed", word: "tomorrow", written: "tomorrow" },
    ]);
  });

  it("does not mis-pair a repeated word", () => {
    expect(diffWords("the saw the dog", "the cat saw the dog")).toEqual([
      { kind: "correct", word: "the", written: "the" },
      { kind: "missed", word: "cat", written: "cat" },
      { kind: "correct", word: "saw", written: "saw" },
      { kind: "correct", word: "the", written: "the" },
      { kind: "correct", word: "dog", written: "dog" },
    ]);
  });

  it("aligns a sentence typed in a different order", () => {
    expect(diffWords("the dog saw the cat", "the cat saw the dog")).toEqual([
      { kind: "correct", word: "the", written: "the" },
      { kind: "replaced", word: "cat", written: "cat", typed: "dog" },
      { kind: "correct", word: "saw", written: "saw" },
      { kind: "correct", word: "the", written: "the" },
      { kind: "replaced", word: "dog", written: "dog", typed: "cat" },
    ]);
    expect(diffWords("morning good", "good morning")).toEqual([
      { kind: "replaced", word: "good", written: "good", typed: "morning" },
      { kind: "replaced", word: "morning", written: "morning", typed: "good" },
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
    expect(diffWords("2026", "2026")).toEqual([{ kind: "correct", word: "2026", written: "2026" }]);
    expect(allCorrect("2026", "two thousand twenty six")).toBe(false);
  });

  it("still marks a wrong number and a non-number word", () => {
    expect(diffWords("I get up at 6:45", "I get up at six thirty.").slice(-3)).toEqual([
      { kind: "correct", word: "six", written: "six" },
      { kind: "replaced", word: "thirty", written: "thirty", typed: "forty" },
      { kind: "extra", typed: "five" },
    ]);
    expect(diffWords("cat", "dog")).toEqual([{ kind: "replaced", word: "dog", written: "dog", typed: "cat" }]);
  });

  it("scores a recognizer transcript with digits all correct", () => {
    expect(allCorrect("I get up at 6:30", "I get up at six thirty.")).toBe(true);
  });

  it("applies to the blank check", () => {
    expect(blankMatches("7", "seven")).toBe(true);
    expect(blankMatches("8", "seven")).toBe(false);
  });
});

describe("hintFor", () => {
  it.each([
    ["Good morning, how are you today?", "G___ m______, h__ a__ y__ t____?"],
    ["I get up at 6:30.", "I g__ u_ a_ 6:30."],
    ["It's 7 o'clock", "I_'_ 7 o'_____"],
    ["I wear a T-shirt.", "I w___ a T-s____."],
    ["", ""],
  ])("masks %j", (text, hint) => {
    expect(hintFor(text)).toBe(hint);
  });
});

describe("endingHints", () => {
  it.each([
    ["s", "I work here", "He works here", "works"],
    ["es", "She watch TV", "She watches TV", "watches"],
    ["'s", "It is Lan book", "It is Lan's book", "Lan's"],
    ["d", "I live there", "I lived there", "lived"],
    ["ed", "I want tea", "I wanted tea", "wanted"],
    ["t", "I learn it", "I learnt it", "learnt"],
  ])("flags a dropped %s", (_ending, typed, reference, word) => {
    expect(endingHints(diffWords(typed, reference))).toEqual([word]);
  });

  it("names the word as the lesson writes it", () => {
    expect(endingHints(diffWords("It is John book", "It is John's book."))).toEqual(["John's"]);
  });

  it("lists each flagged word once, in order", () => {
    expect(endingHints(diffWords("I want tea and ask", "I wanted tea and asked"))).toEqual(["wanted", "asked"]);
    expect(endingHints(diffWords("work work", "works works"))).toEqual(["works"]);
  });

  it.each([
    ["another word", "I wander", "I wanted"],
    ["a correct word", "I wanted tea", "I wanted tea"],
    ["a missed word", "I tea", "I wanted tea"],
    ["an added ending", "I wanted tea", "I want tea"],
    ["an ending not on the list", "I go", "I going"],
  ])("ignores %s", (_name, typed, reference) => {
    expect(endingHints(diffWords(typed, reference))).toEqual([]);
  });
});

describe("wordBank", () => {
  const words = ["my", "name", "is", "lan", "i", "come", "from", "vietnam", "like", "coffee", "i'm", "twenty-five", ", "];

  it("offers the answer and three distractors closest in length, first appearance on ties", () => {
    const choices = wordBank("name", words, "about-me-1");
    expect([...choices].sort()).toEqual(["come", "from", "like", "name"]);
  });

  it("skips the answer in any case and non-word parts", () => {
    const choices = wordBank("Coffee", ["coffee", "COFFEE", "tea", "milk", ", "], "s");
    expect([...choices].sort()).toEqual(["Coffee", "milk", "tea"]);
  });

  it("shows each word as written at its first appearance", () => {
    const choices = wordBank("English", ["I", "come", "from", "Vietnam", ".", "vietnam", "English", "Come"], "s");
    expect([...choices].sort()).toEqual(["English", "Vietnam", "come", "from"]);
  });

  it("orders the choices the same for the same seed and differently across seeds", () => {
    expect(wordBank("name", words, "about-me-1")).toEqual(wordBank("name", words, "about-me-1"));
    const orders = new Set(["a", "b", "c", "d", "e", "f"].map((seed) => wordBank("name", words, seed).join(" ")));
    expect(orders.size).toBeGreaterThan(1);
  });

  it("offers no bank with fewer than two distractors", () => {
    expect(wordBank("tea", ["tea", "milk"], "s")).toEqual([]);
    expect(wordBank("tea", [], "s")).toEqual([]);
  });
});
