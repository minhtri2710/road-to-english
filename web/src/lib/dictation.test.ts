import { describe, expect, it } from "vitest";

import { matchesReference, normalize } from "./dictation";

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

describe("matchesReference", () => {
  it.each([
    ["exact match", "Good morning", "Good morning", true],
    ["apostrophe", "its", "It's", true],
    ["hyphen", "sign off", "sign-off", true],
    ["dropped word", "Good today", "Good morning today", false],
  ])("returns $3 for %s", (_name, typed, reference, expected) => {
    expect(matchesReference(typed, reference)).toBe(expected);
  });
});
