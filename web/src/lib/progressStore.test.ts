import { describe, expect, it } from "vitest";

import {
  getCompletedLessons,
  getPracticeDays,
  markLessonComplete,
  recordPractice,
} from "./progressStore";

describe("progress store", () => {
  it("round-trips practice days and completed lessons", async () => {
    await recordPractice("2026-01-05");
    await recordPractice("2026-01-05");
    await markLessonComplete("lesson-1");

    expect(await getPracticeDays()).toEqual(["2026-01-05"]);
    expect(await getCompletedLessons()).toEqual(["lesson-1"]);
  });
});
