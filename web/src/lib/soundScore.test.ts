import { describe, expect, it } from "vitest";

import { soundScore } from "./soundScore";

const RATE = 8000;

// Tone for each [seconds, loud] segment in turn.
function clip(segments: [number, boolean][]): Float32Array {
  const parts = segments.flatMap(([seconds, loud]) =>
    Array.from({ length: Math.round(seconds * RATE) }, (_, i) => (loud ? 0.5 * Math.sin(i / 3) : 0.001 * Math.sin(i))),
  );
  return Float32Array.from(parts);
}

describe("soundScore", () => {
  it("scores speech at the target pace with no pauses as full marks", () => {
    // 6 words in 4 seconds is 90 WPM, after half a second of silence either side.
    const result = soundScore(clip([[0.5, false], [4, true], [0.5, false]]), RATE, 6, 90);
    expect(result).toMatchObject({ wpm: 90, pace: "good", pauses: 0, score: 100 });
    expect(result!.speechSeconds).toBeCloseTo(4, 1);
  });

  it("marks slow speech and counts long pauses", () => {
    const result = soundScore(clip([[3, true], [0.6, false], [3, true], [0.5, false], [2, true]]), RATE, 6, 90);
    expect(result!.pace).toBe("slow");
    expect(result!.pauses).toBe(2);
    expect(result!.score).toBeLessThan(50);
  });

  it("marks fast speech", () => {
    expect(soundScore(clip([[2, true]]), RATE, 6, 90)!.pace).toBe("fast");
  });

  it("ignores short gaps between words", () => {
    expect(soundScore(clip([[2, true], [0.2, false], [2, true]]), RATE, 6, 90)!.pauses).toBe(0);
  });

  it("returns null for silence or a tap", () => {
    expect(soundScore(clip([[2, false]]), RATE, 6, 90)).toBeNull();
    expect(soundScore(clip([[1, false], [0.1, true], [1, false]]), RATE, 6, 90)).toBeNull();
    expect(soundScore(clip([[2, true]]), RATE, 0, 90)).toBeNull();
  });
});
