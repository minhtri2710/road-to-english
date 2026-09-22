import { openAppDatabase } from "./db";

export async function recordPractice(dateKey: string): Promise<void> {
  const db = await openAppDatabase();
  try {
    await db.put("practiceDays", { date: dateKey });
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
