import { withDb, type DailyCount } from "./db";
import { notifyLocalMutation } from "./syncEvents";

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

export async function getDailyCount(dateKey: string): Promise<DailyCount> {
  return withDb(async (db) => {
    return (await db.get("dailyCounts", dateKey)) ?? { date: dateKey, actions: 0, newCards: 0 };
  });
}

export async function getAllDailyCounts(): Promise<DailyCount[]> {
  return withDb(async (db) => {
    return await db.getAll("dailyCounts");
  });
}

export async function getPracticeDays(): Promise<string[]> {
  return withDb(async (db) => {
    return (await db.getAll("practiceDays")).map(({ date }) => date);
  });
}

export async function markLessonComplete(lessonId: string): Promise<void> {
  return withDb(async (db) => {
    await db.put("lessonCompletion", { lessonId });
    notifyLocalMutation();
  });
}

export async function getCompletedLessons(): Promise<string[]> {
  return withDb(async (db) => {
    return (await db.getAll("lessonCompletion")).map(({ lessonId }) => lessonId);
  });
}
