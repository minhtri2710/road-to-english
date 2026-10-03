import { describe, expect, it } from "vitest";

import { PASS_SCORE, scoreShadow, similarity, wordLevel } from "./shadowScore";

describe("similarity", () => {
  it("is 1 for the same letters and 0 for nothing in common", () => {
    expect(similarity("Seen!", "seen")).toBe(1);
    expect(similarity("abc", "xyz")).toBe(0);
  });

  it("scores a one-letter slip high", () => {
    expect(similarity("scene", "seen")).toBeCloseTo(0.6);
  });
});

describe("wordLevel", () => {
  it("splits at 80 and 50", () => {
    expect(wordLevel(80)).toBe("good");
    expect(wordLevel(79)).toBe("fair");
    expect(wordLevel(50)).toBe("fair");
    expect(wordLevel(49)).toBe("miss");
  });
});

describe("scoreShadow", () => {
  it("passes a sentence said exactly", () => {
    const result = scoreShadow("good morning how are you today", "Good morning, how are you today?");
    expect(result.score).toBe(100);
    expect(result.passed).toBe(true);
    expect(result.words.map((word) => word.level)).toEqual(Array(6).fill("good"));
  });

  it("marks a near miss fair and a wrong word as a miss, with what was heard", () => {
    const result = scoreShadow("I've never scene everyone like it", "I've never seen anything like it.");
    const [, , seen, anything] = result.words;
    expect(seen).toMatchObject({ word: "seen", level: "fair", heard: "scene" });
    expect(anything).toMatchObject({ word: "anything", level: "miss", heard: "everyone" });
  });

  it("scores missed words zero and fails below the pass score", () => {
    const result = scoreShadow("good morning", "Good morning, how are you today?");
    expect(result.words.filter((word) => word.level === "miss")).toHaveLength(4);
    expect(result.score).toBe(33);
    expect(result.score).toBeLessThan(PASS_SCORE);
    expect(result.passed).toBe(false);
  });

  it("ignores extra words the recognizer adds", () => {
    expect(scoreShadow("um good morning", "Good morning").score).toBe(100);
  });

  it("scores nothing heard as zero", () => {
    expect(scoreShadow("", "Hello there").score).toBe(0);
  });
});
