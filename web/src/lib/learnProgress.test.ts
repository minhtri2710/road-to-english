import { describe, expect, it } from "vitest";

import { withDb } from "./db";
import {
  applyLearnChange,
  onLearnProgressChanged,
  notifyLearnProgressChanged,
  readLearnProgress,
  shouldApplyLearnReply,
  SKIPS_PER_LESSON,
} from "./learnProgress";

describe("learn progress", () => {
  it("round-trips a lesson's passed sentences and skips, stamped with the write time", async () => {
    await applyLearnChange("l1", { kind: "pass", sentenceId: "s1" }, new Date("2026-09-22T10:00:00Z"));
    await applyLearnChange("l1", { kind: "skip", sentenceId: "s2" }, new Date("2026-09-22T10:00:00Z"));
    expect(await readLearnProgress("l1")).toEqual({ passed: ["s1", "s2"], skipsUsed: 1 });
    expect(await readLearnProgress("l2")).toEqual({ passed: [], skipsUsed: 0 });
    expect(await withDb((db) => db.get("learnProgress", "l1"))).toMatchObject({
      lessonId: "l1",
      passed: ["s1", "s2"],
      skipsUsed: 1,
      updatedAt: "2026-09-22T10:00:00.001Z",
    });
  });

  it("keeps empty progress, so a Start over can sync", async () => {
    await applyLearnChange("l1", { kind: "pass", sentenceId: "s1" });
    await applyLearnChange("l1", { kind: "reset" });
    expect(await withDb((db) => db.get("learnProgress", "l1"))).toMatchObject({ passed: [], skipsUsed: 0 });
  });

  it("commits overlapping changes atomically: a same-sentence race costs one skip", async () => {
    await Promise.all([
      applyLearnChange("l1", { kind: "skip", sentenceId: "s1" }),
      applyLearnChange("l1", { kind: "skip", sentenceId: "s1" }),
    ]);
    expect(await readLearnProgress("l1")).toEqual({ passed: ["s1"], skipsUsed: 1 });
  });

  it("keeps several concurrent distinct skips, and a skip at the cap does not pass", async () => {
    await Promise.all([
      applyLearnChange("l1", { kind: "skip", sentenceId: "s1" }),
      applyLearnChange("l1", { kind: "skip", sentenceId: "s2" }),
      applyLearnChange("l1", { kind: "skip", sentenceId: "s3" }),
    ]);
    const progress = await readLearnProgress("l1");
    expect(progress.skipsUsed).toBe(SKIPS_PER_LESSON);
    expect(new Set(progress.passed)).toEqual(new Set(["s1", "s2", "s3"]));
    const stored = await withDb((db) => db.get("learnProgress", "l1"));
    // A skip at the cap is a no-op: it does not pass, stamp, or write anything.
    expect(
      await applyLearnChange("l1", { kind: "skip", sentenceId: "s4" }),
    ).toEqual(progress);
    expect(await withDb((db) => db.get("learnProgress", "l1"))).toEqual(stored);
  });

  it("stamps each successive edit later than the stored one, even when the clock goes backwards", async () => {
    await applyLearnChange("l1", { kind: "pass", sentenceId: "s1" }, new Date("2026-09-22T10:00:00Z"));
    await applyLearnChange("l1", { kind: "pass", sentenceId: "s2" }, new Date("2026-09-22T10:00:00Z"));
    const second = await withDb((db) => db.get("learnProgress", "l1"));
    expect(second?.updatedAt).toBe("2026-09-22T10:00:00.001Z");
    await applyLearnChange("l1", { kind: "pass", sentenceId: "s3" }, new Date("2026-09-22T09:00:00Z"));
    expect(await withDb((db) => db.get("learnProgress", "l1"))).toMatchObject({
      updatedAt: "2026-09-22T10:00:00.002Z",
    });
  });

  it("prefers the newer reply, and the reply at an equal time only when it differs", () => {
    const at = (updatedAt: string, rest: object = {}) => ({ lessonId: "l1", passed: [], skipsUsed: 0, updatedAt, ...rest });
    expect(shouldApplyLearnReply(undefined, at("2026-09-22T10:00:00Z"))).toBe(true);
    expect(shouldApplyLearnReply(at("2026-09-22T10:00:00Z"), at("2026-09-22T11:00:00Z"))).toBe(true);
    expect(shouldApplyLearnReply(at("2026-09-22T11:00:00Z"), at("2026-09-22T10:00:00Z"))).toBe(false);
    // Equivalent payload at the same instant is not applied again, even across timestamp spellings.
    expect(shouldApplyLearnReply(at("2026-09-22T10:00:00.000Z"), at("2026-09-22T10:00:00Z"))).toBe(false);
    expect(shouldApplyLearnReply(at("2026-09-22T10:00:00Z"), at("2026-09-22T10:00:00Z", { skipsUsed: 1 }))).toBe(true);
    expect(shouldApplyLearnReply(at("2026-09-22T10:00:00Z", { passed: ["s1"] }), at("2026-09-22T10:00:00Z"))).toBe(true);
    expect(
      shouldApplyLearnReply(at("2026-09-22T10:00:00Z", { passed: ["s1", "s2"] }), at("2026-09-22T10:00:00Z", { passed: ["s2", "s1"] })),
    ).toBe(true);
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
