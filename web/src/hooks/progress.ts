import { useCallback, useEffect, useState } from "react";

import type { DailyCount } from "../lib/db";
import { streakState, todayKey, weekView, xp } from "../lib/progress";
import {
  getAllDailyCounts,
  getCompletedLessons,
  getDailyCount,
  getPracticeDays,
  markLessonComplete as saveLessonCompletion,
  recordPractice as savePractice,
} from "../lib/progressStore";

export function useProgress() {
  const [practiceDays, setPracticeDays] = useState<string[]>([]);
  const [completedLessons, setCompletedLessons] = useState<Set<string>>(
    () => new Set(),
  );
  const [dailyCount, setDailyCount] = useState<DailyCount | null>(null);
  const [allCounts, setAllCounts] = useState<DailyCount[]>([]);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [days, lessons, count, counts] = await Promise.all([
        getPracticeDays(),
        getCompletedLessons(),
        getDailyCount(todayKey(new Date())),
        getAllDailyCounts(),
      ]);
      setPracticeDays(days);
      setCompletedLessons(new Set(lessons));
      setDailyCount(count);
      setAllCounts(counts);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError : new Error("Unable to load progress"));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Practice is recorded in the background; a failed write surfaces as `error`, not a rejection.
  const recordPractice = useCallback(async (options: { newCard: boolean }) => {
    try {
      await savePractice(todayKey(new Date()), options);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError : new Error("Unable to save progress"));
      return;
    }
    await refresh();
  }, [refresh]);

  const markLessonComplete = useCallback(
    async (lessonId: string) => {
      await saveLessonCompletion(lessonId);
      await refresh();
    },
    [refresh],
  );

  const today = todayKey(new Date());
  // A count loaded before local midnight belongs to another day.
  const todayCount = dailyCount?.date === today ? dailyCount : undefined;
  const { streak, freezes } = streakState(practiceDays, today);
  return {
    actionsToday: todayCount?.actions ?? 0,
    newCardsToday: todayCount?.newCards ?? 0,
    streak,
    freezes,
    // XP is local-only: dailyCounts is not synced.
    xp: xp(allCounts),
    week: weekView(practiceDays, today),
    completedLessons,
    error,
    recordPractice,
    markLessonComplete,
    reload: refresh,
  };
}
