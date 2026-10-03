import { withDb, type StoredLearnProgress } from "./db";
import { readPref, writePref } from "./prefs";
import { notifyLocalMutation } from "./syncEvents";

// "on" while the learner keeps Learn mode on in the guided view; every lesson opens in it. A device preference: not synced.
export const LEARN_MODE_KEY = "road-to-english.learnMode";

// Before sync carried it, progress lived in localStorage under this prefix; it moves into the database on first read.
const legacyKey = (lessonId: string) => `road-to-english.learnProgress.${lessonId}`;

// A lesson's Shadow Gate progress: the sentences passed or skipped, and the skips used. Synced and backed up
// per lesson, where the newer updatedAt wins, so a Start over carries to other devices too.
export interface LearnProgress {
  passed: string[];
  skipsUsed: number;
}

export const EMPTY_LEARN_PROGRESS: LearnProgress = { passed: [], skipsUsed: 0 };

function parseLegacy(raw: string | null): LearnProgress | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const { passed, skipsUsed } = value as Partial<LearnProgress>;
    return {
      passed: Array.isArray(passed) ? [...new Set(passed.filter((id): id is string => typeof id === "string" && id !== ""))] : [],
      skipsUsed: typeof skipsUsed === "number" && Number.isInteger(skipsUsed) && skipsUsed >= 0 ? skipsUsed : 0,
    };
  } catch {
    return null;
  }
}

export async function readLearnProgress(lessonId: string): Promise<LearnProgress> {
  const stored = await withDb((db) => db.get("learnProgress", lessonId));
  if (stored) return { passed: stored.passed, skipsUsed: stored.skipsUsed };
  const legacy = parseLegacy(readPref(legacyKey(lessonId)));
  if (!legacy) return EMPTY_LEARN_PROGRESS;
  await writeLearnProgress(lessonId, legacy);
  writePref(legacyKey(lessonId), null);
  return legacy;
}

// Stores the lesson's progress, stamped now, and asks for a sync. Empty progress is kept too: it is how a
// Start over reaches the other devices.
export async function writeLearnProgress(lessonId: string, progress: LearnProgress, now = new Date()): Promise<void> {
  const record: StoredLearnProgress = {
    lessonId,
    passed: progress.passed,
    skipsUsed: progress.skipsUsed,
    updatedAt: now.toISOString(),
  };
  await withDb((db) => db.put("learnProgress", record));
  notifyLocalMutation();
}

// The newer of two copies of one lesson's progress; an equal time keeps the local copy.
export function newerLearnProgress(local: StoredLearnProgress | undefined, remote: StoredLearnProgress): boolean {
  return local === undefined || Date.parse(remote.updatedAt) > Date.parse(local.updatedAt);
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
