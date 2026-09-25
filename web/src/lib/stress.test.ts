import { describe, expect, it } from "vitest";

import { intonation, loadStressDict, wordStress, type StressDict } from "./stress";

const dict: StressDict = {
  banana: "010",
  record: "01,10",
  today: "01",
  morning: "10",
  photograph: "102,100",
  anyway: "120,1",
  "don't": "1",
  "can't": "1",
  "isn't": "10",
  never: "10",
  not: "1",
  no: "1",
  what: "1",
  "what's": "1",
  how: "1",
  "t-shirt": "12",
  twice: "11",
  hmm: "",
  the: "0,1",
  a: "0,1",
  "it's": "1",
  "you're": "1",
  "i'm": "1",
  "we'll": "1",
  "she'd": "1",
  "they've": "1",
  that: "1",
  over: "10",
  because: "01",
  when: "1",
};

describe("wordStress", () => {
  it.each([
    ["banana", { syllables: 3, primary: 1 }],
    ["Banana", { syllables: 3, primary: 1 }],
    ["today", { syllables: 2, primary: 1 }],
    ["morning", { syllables: 2, primary: 0 }],
    // Patterns that agree on the syllable count and primary position, differing only in secondary stress.
    ["photograph", { syllables: 3, primary: 0 }],
    ["t-shirt", { syllables: 2, primary: 0 }],
  ])("marks the content word %s", (word, stress) => {
    expect(wordStress(word, dict)).toEqual(stress);
  });

  it.each([
    ["don't", { syllables: 1, primary: 0 }],
    ["Don’t", { syllables: 1, primary: 0 }],
    ["can't", { syllables: 1, primary: 0 }],
    ["isn't", { syllables: 2, primary: 0 }],
    ["never", { syllables: 2, primary: 0 }],
    ["not", { syllables: 1, primary: 0 }],
    ["no", { syllables: 1, primary: 0 }],
  ])("stresses the negative %s", (word, stress) => {
    expect(wordStress(word, dict)).toEqual(stress);
  });

  it.each(["what", "What's", "how", "when"])("stresses the wh-word %s", (word) => {
    expect(wordStress(word, dict)).toEqual({ syllables: 1, primary: 0 });
  });

  it.each(["the", "a", "A", "that", "over", "because", "it's", "It’s", "you're", "I'm", "we'll", "she'd", "they've"])(
    "leaves the function word %s unmarked",
    (word) => {
      expect(wordStress(word, dict)).toBeNull();
    },
  );

  it.each([
    ["record", "a noun/verb pair"],
    ["anyway", "patterns with different syllable counts"],
    ["twice", "two primary stresses"],
    ["hmm", "no vowel"],
    ["zebra", "a word missing from the dictionary"],
    ["constructor", "an Object.prototype name missing from the dictionary"],
  ])("leaves %s unmarked: %s", (word) => {
    expect(wordStress(word, dict)).toBeNull();
  });
});

describe("intonation", () => {
  it.each([
    ["See you tomorrow.", "falling"],
    ["What a day!", "falling"],
    ["Stop!  ", "falling"],
    ["Where do you live?", "falling"],
    ["What's your name?", "falling"],
    ["How are you today?", "falling"],
    ["Do you like it?", "rising"],
    ["Is it nice?", "rising"],
    ["Can you help me?", "rising"],
    ["Have you eaten?", "rising"],
    ["It is nice, isn't it?", null],
    ["Tea or coffee?", null],
    ["You're leaving?", null],
    ["Don't you like it?", null],
    ["Good morning", null],
    ["Good morning,", null],
    ["?", null],
  ])("%s -> %s", (text, expected) => {
    expect(intonation(text)).toBe(expected);
  });
});

describe("the vendored dictionary", () => {
  it("marks known words from CMUdict", async () => {
    const vendored = await loadStressDict();
    expect(wordStress("banana", vendored)).toEqual({ syllables: 3, primary: 1 });
    expect(wordStress("today", vendored)).toEqual({ syllables: 2, primary: 1 });
    expect(wordStress("record", vendored)).toBeNull();
  });
});
