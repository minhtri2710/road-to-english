import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { withDb } from "./db";
import { newerLearnProgress, onLearnProgressChanged, notifyLearnProgressChanged, readLearnProgress, writeLearnProgress } from "./learnProgress";

describe("learn progress", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => localStorage.clear());

  it("round-trips a lesson's passed sentences and skips, stamped with the write time", async () => {
    await writeLearnProgress("l1", { passed: ["s1", "s2"], skipsUsed: 1 }, new Date("2026-09-22T10:00:00Z"));
    expect(await readLearnProgress("l1")).toEqual({ passed: ["s1", "s2"], skipsUsed: 1 });
    expect(await readLearnProgress("l2")).toEqual({ passed: [], skipsUsed: 0 });
    expect(await withDb((db) => db.get("learnProgress", "l1"))).toEqual({
      lessonId: "l1",
      passed: ["s1", "s2"],
      skipsUsed: 1,
      updatedAt: "2026-09-22T10:00:00.000Z",
    });
  });

  it("keeps empty progress, so a Start over can sync", async () => {
    await writeLearnProgress("l1", { passed: ["s1"], skipsUsed: 0 });
    await writeLearnProgress("l1", { passed: [], skipsUsed: 0 });
    expect(await withDb((db) => db.get("learnProgress", "l1"))).toMatchObject({ passed: [], skipsUsed: 0 });
  });

  it("moves progress saved before sync out of localStorage, and reads damaged copies safely", async () => {
    localStorage.setItem("road-to-english.learnProgress.l1", JSON.stringify({ passed: [1, "s1", "s1"], skipsUsed: 2 }));
    expect(await readLearnProgress("l1")).toEqual({ passed: ["s1"], skipsUsed: 2 });
    expect(localStorage.getItem("road-to-english.learnProgress.l1")).toBeNull();
    expect(await withDb((db) => db.get("learnProgress", "l1"))).toMatchObject({ passed: ["s1"], skipsUsed: 2 });

    localStorage.setItem("road-to-english.learnProgress.l2", "{not json");
    expect(await readLearnProgress("l2")).toEqual({ passed: [], skipsUsed: 0 });
  });

  it("prefers the newer copy, and the local one at an equal time", () => {
    const at = (updatedAt: string) => ({ lessonId: "l1", passed: [], skipsUsed: 0, updatedAt });
    expect(newerLearnProgress(undefined, at("2026-09-22T10:00:00Z"))).toBe(true);
    expect(newerLearnProgress(at("2026-09-22T10:00:00Z"), at("2026-09-22T11:00:00Z"))).toBe(true);
    expect(newerLearnProgress(at("2026-09-22T10:00:00Z"), at("2026-09-22T10:00:00.000Z"))).toBe(false);
    expect(newerLearnProgress(at("2026-09-22T10:00:00Z"), at("2026-09-22T09:00:00Z"))).toBe(false);
  });

  it("tells listeners when progress changed elsewhere", () => {
    let calls = 0;
    const stop = onLearnProgressChanged(() => calls++);
    notifyLearnProgressChanged();
    stop();
    notifyLearnProgressChanged();
    expect(calls).toBe(1);
  });
});
