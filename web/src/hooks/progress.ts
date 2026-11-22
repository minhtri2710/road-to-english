import { useCallback, useEffect, useMemo, useState } from "react";

import { tr } from "../i18n";
import type { DailyCount } from "../lib/db";
import { streakState, todayKey, weekView } from "../lib/progress";
import {
  markLessonComplete as saveLessonCompletion,
  readProgressSnapshot,
  recordPractice as savePractice,
  type ProgressSnapshot,
} from "../lib/progressStore";

export function useProgress() {
  const [progress, setProgress] = useState<ProgressSnapshot>(() => ({
    practiceDays: [], completedLessons: new Set(), dailyCount: null, xp: 0,
  }));
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    try {
      setProgress(await readProgressSnapshot(todayKey(new Date())));
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError : new Error(tr("Unable to load progress")));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Practice is recorded in the background; it resolves to the day's committed count, or null after a failed write,
  // which surfaces as `error` rather than a rejection.
  const recordPractice = useCallback(async (options: { newCard: boolean }): Promise<DailyCount | null> => {
    let committed: DailyCount;
    try {
      committed = await savePractice(todayKey(new Date()), options);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError : new Error(tr("Unable to save progress")));
      return null;
    }
    await refresh();
    return committed;
  }, [refresh]);

  const markLessonComplete = useCallback(
    async (lessonId: string) => {
      await saveLessonCompletion(lessonId);
      await refresh();
    },
    [refresh],
  );

  const today = todayKey(new Date());
  const { practiceDays, dailyCount, completedLessons } = progress;
  // A count loaded before local midnight belongs to another day.
  const todayCount = dailyCount?.date === today ? dailyCount : undefined;
  const { streak, freezes, week } = useMemo(() => ({
    ...streakState(practiceDays, today), week: weekView(practiceDays, today),
  }), [practiceDays, today]);
  return {
    actionsToday: todayCount?.actions ?? 0,
    newCardsToday: todayCount?.newCards ?? 0,
    streak,
    freezes,
    // XP is local-only: dailyCounts is not synced.
    xp: progress.xp,
    week,
    completedLessons,
    error,
    recordPractice,
    markLessonComplete,
    reload: refresh,
  };
}
