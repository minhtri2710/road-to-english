import { withDb, type DailyCount } from "./db";
import { xp } from "./progress";
import { notifyLocalMutation } from "./syncEvents";

export interface ProgressSnapshot {
  practiceDays: string[];
  completedLessons: Set<string>;
  dailyCount: DailyCount | null;
  xp: number;
}

export async function recordPractice(
  dateKey: string,
  { newCard }: { newCard: boolean },
): Promise<DailyCount> {
  return withDb(async (db) => {
    const tx = db.transaction(["practiceDays", "dailyCounts"], "readwrite");
    tx.objectStore("practiceDays").put({ date: dateKey });
    const counts = tx.objectStore("dailyCounts");
    const current = (await counts.get(dateKey)) ?? { date: dateKey, actions: 0, newCards: 0 };
    const committed = {
      date: dateKey,
      actions: current.actions + 1,
      newCards: current.newCards + (newCard ? 1 : 0),
    };
    counts.put(committed);
    await tx.done;
    notifyLocalMutation();
    return committed;
  });
}

export async function markLessonComplete(lessonId: string): Promise<void> {
  return withDb(async (db) => {
    await db.put("lessonCompletion", { lessonId });
    notifyLocalMutation();
  });
}

export function readProgressSnapshot(dateKey: string): Promise<ProgressSnapshot> {
  return withDb(async (db) => {
    const tx = db.transaction(["practiceDays", "lessonCompletion", "dailyCounts"], "readonly");
    const [practiceDays, completed, counts] = await Promise.all([
      tx.objectStore("practiceDays").getAllKeys(),
      tx.objectStore("lessonCompletion").getAllKeys(),
      tx.objectStore("dailyCounts").getAll(),
      tx.done,
    ]);
    return {
      practiceDays,
      completedLessons: new Set(completed),
      dailyCount: counts.find(({ date }) => date === dateKey) ?? null,
      xp: xp(counts),
    };
  });
}
