import { describe, expect, it } from "vitest";

import { coverBars } from "./LessonCard";

describe("coverBars", () => {
  it("draws the same cover for a title every time, and a different one for another title", () => {
    expect(coverBars("About Me")).toEqual(coverBars("About Me"));
    expect(coverBars("About Me")).not.toEqual(coverBars("My Family"));
  });

  it("keeps every bar between 20% and 100% high", () => {
    for (const height of coverBars("Greetings & Basics")) {
      expect(height).toBeGreaterThanOrEqual(20);
      expect(height).toBeLessThanOrEqual(100);
    }
  });
});
