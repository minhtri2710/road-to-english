import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { blankMatches, diffWords } from "./dictation";
import { cardId } from "./vocab";
import { cardWord, isCardWord, splitWords } from "./words";

// The card-word vectors the api validation test reads too.
const vectors = JSON.parse(
  readFileSync(`${import.meta.dirname}/../../../api/internal/storage/testdata/card-words.json`, "utf8"),
) as { accept: string[]; reject: string[] };

const NFC_CAFE = "café";
const NFD_CAFE = "café";

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
    ["Zoë", "zoë"],
    ["Café", "café"],
    ["İ", "i̇"],
    ["ΟΔΟΣ", "οδος"],
    [NFD_CAFE, NFC_CAFE],
  ])("derives %j as %j", (part, word) => {
    expect(cardWord(part)).toBe(word);
  });

  it.each(vectors.accept)("accepts shared vector %j", (word) => {
    expect(isCardWord(word)).toBe(true);
  });

  it.each(vectors.reject)("rejects shared vector %j", (word) => {
    expect(isCardWord(word)).toBe(false);
  });

  it("derives accepted shared vectors from İ, ΟΔΟΣ and an NFD café", () => {
    for (const part of ["İ", "ΟΔΟΣ", NFD_CAFE]) {
      expect(vectors.accept).toContain(cardWord(part));
    }
  });
});

describe("splitWords", () => {
  it.each([
    ["I wear a T-shirt and shorts.", ["", "I", " ", "wear", " ", "a", " ", "T-shirt", " ", "and", " ", "shorts", "."]],
    ["twenty-five", ["", "twenty-five", ""]],
    ["a - b", ["", "a", " - ", "b", ""]],
    ["word-", ["", "word", "-"]],
    ["Zoë's café, naïve résumé.", ["", "Zoë's", " ", "café", ", ", "naïve", " ", "résumé", "."]],
  ])("splits %j", (text, parts) => {
    expect(splitWords(text)).toEqual(parts);
  });
});

describe("NFD input", () => {
  it("equals its NFC form for the card word, card id, word parts, diff tokens and blank match", () => {
    const source = (word: string) => ({ lessonId: "user-1", sentenceId: "s1", word: cardWord(word) });
    expect(cardWord(NFD_CAFE)).toBe(cardWord(NFC_CAFE));
    expect(cardId(source(NFD_CAFE))).toBe(cardId(source(NFC_CAFE)));
    const words = (text: string) => splitWords(text).filter((part) => isCardWord(cardWord(part))).map(cardWord);
    expect(words(`A ${NFD_CAFE} au lait`)).toEqual(words(`A ${NFC_CAFE} au lait`));
    expect(words(`A ${NFD_CAFE} au lait`)).toContain(NFC_CAFE);
    expect(diffWords(NFD_CAFE, NFC_CAFE)).toEqual([{ kind: "correct", word: NFC_CAFE, written: NFC_CAFE }]);
    expect(diffWords(NFC_CAFE, NFD_CAFE).map((entry) => entry.kind)).toEqual(["correct"]);
    expect(blankMatches(NFD_CAFE, NFC_CAFE)).toBe(true);
    expect(blankMatches(NFC_CAFE, NFD_CAFE)).toBe(true);
  });
});
