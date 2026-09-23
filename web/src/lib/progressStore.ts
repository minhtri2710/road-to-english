import { openAppDatabase, type DailyCount } from "./db";
import { notifyLocalMutation } from "./syncEvents";

export async function recordPractice(
  dateKey: string,
  { newCard }: { newCard: boolean },
): Promise<void> {
  const db = await openAppDatabase();
  try {
    const tx = db.transaction(["practiceDays", "dailyCounts"], "readwrite");
    tx.objectStore("practiceDays").put({ date: dateKey });
    const counts = tx.objectStore("dailyCounts");
    const current = (await counts.get(dateKey)) ?? { date: dateKey, actions: 0, newCards: 0 };
    counts.put({
      date: dateKey,
      actions: current.actions + 1,
      newCards: current.newCards + (newCard ? 1 : 0),
    });
    await tx.done;
    notifyLocalMutation();
  } finally {
    db.close();
  }
}

export async function getDailyCount(dateKey: string): Promise<DailyCount> {
  const db = await openAppDatabase();
  try {
    return (await db.get("dailyCounts", dateKey)) ?? { date: dateKey, actions: 0, newCards: 0 };
  } finally {
    db.close();
  }
}

export async function getPracticeDays(): Promise<string[]> {
  const db = await openAppDatabase();
  try {
    return (await db.getAll("practiceDays")).map(({ date }) => date);
  } finally {
    db.close();
  }
}

export async function markLessonComplete(lessonId: string): Promise<void> {
  const db = await openAppDatabase();
  try {
    await db.put("lessonCompletion", { lessonId });
    notifyLocalMutation();
  } finally {
    db.close();
  }
}

export async function getCompletedLessons(): Promise<string[]> {
  const db = await openAppDatabase();
  try {
    return (await db.getAll("lessonCompletion")).map(({ lessonId }) => lessonId);
  } finally {
    db.close();
  }
}
