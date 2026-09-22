import { openAppDatabase } from "./db";
import { notifyLocalMutation } from "./syncEvents";

export async function recordPractice(dateKey: string): Promise<void> {
  const db = await openAppDatabase();
  try {
    await db.put("practiceDays", { date: dateKey });
    notifyLocalMutation();
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
