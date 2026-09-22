import { useCallback, useEffect, useState } from "react";

import { streak as calculateStreak, todayKey } from "../lib/progress";
import {
  getCompletedLessons,
  getPracticeDays,
  markLessonComplete as saveLessonCompletion,
  recordPractice as savePractice,
} from "../lib/progressStore";

export function useProgress() {
  const [practiceDays, setPracticeDays] = useState<string[]>([]);
  const [completedLessons, setCompletedLessons] = useState<Set<string>>(
    () => new Set(),
  );

  const refresh = useCallback(async () => {
    const [days, lessons] = await Promise.all([
      getPracticeDays(),
      getCompletedLessons(),
    ]);
    setPracticeDays(days);
    setCompletedLessons(new Set(lessons));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const recordPractice = useCallback(async () => {
    await savePractice(todayKey(new Date()));
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
  return {
    streak: calculateStreak(practiceDays, today),
    practicedToday: practiceDays.includes(today),
    completedLessons,
    recordPractice,
    markLessonComplete,
    reload: refresh,
  };
}
