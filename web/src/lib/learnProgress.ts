import { withDb, type StoredLearnProgress } from "./db";
import { notifyLocalMutation } from "./syncEvents";

// "on" while the learner keeps Learn mode on in the guided view; every lesson opens in it. A device preference: not synced.
export const LEARN_MODE_KEY = "road-to-english.learnMode";

// A lesson's Shadow Gate progress: the sentences passed or skipped, and the skips used. Synced and backed up
// per lesson, where the newer updatedAt wins, so a Start over carries to other devices too.
export interface LearnProgress {
  passed: string[];
  skipsUsed: number;
}

const EMPTY_LEARN_PROGRESS: LearnProgress = { passed: [], skipsUsed: 0 };

export const SKIPS_PER_LESSON = 3;

export async function readLearnProgress(lessonId: string): Promise<LearnProgress> {
  const stored = await withDb((db) => db.get("learnProgress", lessonId));
  if (!stored) return EMPTY_LEARN_PROGRESS;
  return { passed: stored.passed, skipsUsed: stored.skipsUsed };
}

export type LearnChange =
  | { kind: "pass" | "skip"; sentenceId: string }
  | { kind: "reset" };

// The next committed timestamp: after the stored copy even when the clock went backwards. StoredLearnProgress
// rows at the same instant are ordered by the write that produced them.
export function learnStamp(now: Date, existingUpdatedAt?: string): string {
  const stamp = new Date(Math.max(now.getTime(), existingUpdatedAt ? Date.parse(existingUpdatedAt) + 1 : -Infinity));
  if (stamp.getUTCFullYear() > 9999) {
    throw new Error("Learn progress timestamp out of range.");
  }
  return stamp.toISOString();
}

// Applies one committed change to the stored row in a single transaction, and asks for a sync only after the
// write commits. A change already in the stored row is a no-op: nothing is stamped or synced. Both the request
// and the transaction are awaited, so a failed put can never reject unobserved.
export async function applyLearnChange(
  lessonId: string,
  change: LearnChange,
  now = new Date(),
): Promise<LearnProgress> {
  return withDb(async (db) => {
    const tx = db.transaction("learnProgress", "readwrite");
    const changeRow = async () => {
      const existing = await tx.objectStore("learnProgress").get(lessonId);
      const current: LearnProgress = existing
        ? { passed: existing.passed, skipsUsed: existing.skipsUsed }
        : EMPTY_LEARN_PROGRESS;
      if (
        change.kind !== "reset" &&
        (current.passed.includes(change.sentenceId) ||
          (change.kind === "skip" && current.skipsUsed >= SKIPS_PER_LESSON))
      ) {
        return { progress: current, changed: false };
      }
      const next =
        change.kind === "reset"
          ? EMPTY_LEARN_PROGRESS
          : {
              passed: [...current.passed, change.sentenceId],
              skipsUsed: current.skipsUsed + (change.kind === "skip" ? 1 : 0),
            };
      await tx.objectStore("learnProgress").put({
        lessonId,
        ...next,
        updatedAt: learnStamp(now, existing?.updatedAt),
      });
      return { progress: next, changed: true };
    };
    const [{ progress, changed }] = await Promise.all([changeRow(), tx.done]);
    if (changed) notifyLocalMutation();
    return progress;
  });
}

// Whether two Learn progress rows carry the same payload.
export function sameLearnContent(a: LearnProgress, b: LearnProgress): boolean {
  return a.skipsUsed === b.skipsUsed && a.passed.length === b.passed.length && a.passed.every((id, i) => id === b.passed[i]);
}

// Whether a sync reply's copy replaces the local one: newer wins, an equal time wins only when the payload differs.
export function shouldApplyLearnReply(
  local: StoredLearnProgress | undefined,
  remote: StoredLearnProgress,
): boolean {
  if (!local) return true;
  const delta = Date.parse(remote.updatedAt) - Date.parse(local.updatedAt);
  return delta > 0 || (delta === 0 && !sameLearnContent(local, remote));
}

// Lets an open lesson reread its progress after a sync or a backup import changed it.
const changes = new EventTarget();

export function notifyLearnProgressChanged(): void {
  changes.dispatchEvent(new Event("change"));
}

export function onLearnProgressChanged(listener: () => void): () => void {
  changes.addEventListener("change", listener);
  return () => changes.removeEventListener("change", listener);
}
