import { openAppDatabase } from "./db";
import type { BackupData } from "./backup";

export async function exportAll(): Promise<BackupData> {
  const db = await openAppDatabase();
  try {
    const [cards, practiceDays, lessonCompletion] = await Promise.all([
      db.getAll("cards"),
      db.getAll("practiceDays"),
      db.getAll("lessonCompletion"),
    ]);
    return { cards, practiceDays, lessonCompletion };
  } finally {
    db.close();
  }
}

export async function replaceAll(data: BackupData): Promise<void> {
  const db = await openAppDatabase();
  try {
    const tx = db.transaction(
      ["cards", "practiceDays", "lessonCompletion"],
      "readwrite",
    );
    tx.objectStore("cards").clear();
    tx.objectStore("practiceDays").clear();
    tx.objectStore("lessonCompletion").clear();
    data.cards.forEach((card) => tx.objectStore("cards").put(card));
    data.practiceDays.forEach((practiceDay) =>
      tx.objectStore("practiceDays").put(practiceDay),
    );
    data.lessonCompletion.forEach((completion) =>
      tx.objectStore("lessonCompletion").put(completion),
    );
    await tx.done;
  } finally {
    db.close();
  }
}
