import { useCallback, useEffect, useState } from "react";

import type { DailyCount } from "../lib/db";
import { streak as calculateStreak, todayKey } from "../lib/progress";
import {
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

  const refresh = useCallback(async () => {
    const [days, lessons, count] = await Promise.all([
      getPracticeDays(),
      getCompletedLessons(),
      getDailyCount(todayKey(new Date())),
    ]);
    setPracticeDays(days);
    setCompletedLessons(new Set(lessons));
    setDailyCount(count);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const recordPractice = useCallback(async (options: { newCard: boolean }) => {
    await savePractice(todayKey(new Date()), options);
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
  return {
    actionsToday: todayCount?.actions ?? 0,
    newCardsToday: todayCount?.newCards ?? 0,
    streak: calculateStreak(practiceDays, today),
    practicedToday: practiceDays.includes(today),
    completedLessons,
    recordPractice,
    markLessonComplete,
    reload: refresh,
  };
}
