import { readPref, writePref } from "./prefs";

// "on" while the learner keeps Learn mode on in the guided view; every lesson opens in it.
export const LEARN_MODE_KEY = "road-to-english.learnMode";

const progressKey = (lessonId: string) => `road-to-english.learnProgress.${lessonId}`;

// A lesson's Shadow Gate progress on this device: the sentences passed or skipped, and the skips used.
export interface LearnProgress {
  passed: string[];
  skipsUsed: number;
}

const EMPTY: LearnProgress = { passed: [], skipsUsed: 0 };

export function readLearnProgress(lessonId: string): LearnProgress {
  const raw = readPref(progressKey(lessonId));
  if (raw === null) return EMPTY;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return EMPTY;
    const { passed, skipsUsed } = value as Partial<LearnProgress>;
    return {
      passed: Array.isArray(passed) ? passed.filter((id): id is string => typeof id === "string") : [],
      skipsUsed: typeof skipsUsed === "number" && Number.isInteger(skipsUsed) && skipsUsed >= 0 ? skipsUsed : 0,
    };
  } catch {
    return EMPTY;
  }
}

// Empty progress removes the key, so starting over leaves nothing behind.
export function writeLearnProgress(lessonId: string, progress: LearnProgress): void {
  const empty = progress.passed.length === 0 && progress.skipsUsed === 0;
  writePref(progressKey(lessonId), empty ? null : JSON.stringify(progress));
}
