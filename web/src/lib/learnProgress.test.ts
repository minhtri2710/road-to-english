import { beforeEach, describe, expect, it } from "vitest";

import { readLearnProgress, writeLearnProgress } from "./learnProgress";

describe("learn progress", () => {
  beforeEach(() => localStorage.clear());

  it("round-trips a lesson's passed sentences and skips", () => {
    writeLearnProgress("l1", { passed: ["s1", "s2"], skipsUsed: 1 });
    expect(readLearnProgress("l1")).toEqual({ passed: ["s1", "s2"], skipsUsed: 1 });
    expect(readLearnProgress("l2")).toEqual({ passed: [], skipsUsed: 0 });
  });

  it("removes the key when progress is empty", () => {
    writeLearnProgress("l1", { passed: ["s1"], skipsUsed: 0 });
    writeLearnProgress("l1", { passed: [], skipsUsed: 0 });
    expect(localStorage.length).toBe(0);
  });

  it("reads damaged progress as empty", () => {
    localStorage.setItem("road-to-english.learnProgress.l1", "{not json");
    expect(readLearnProgress("l1")).toEqual({ passed: [], skipsUsed: 0 });
    localStorage.setItem("road-to-english.learnProgress.l1", JSON.stringify({ passed: [1, "s1"], skipsUsed: -2 }));
    expect(readLearnProgress("l1")).toEqual({ passed: ["s1"], skipsUsed: 0 });
  });
});
