import { withDb } from "./db";
import { mergeCard } from "./mergeCard";
import { notifyLocalMutation } from "./syncEvents";
import type { BackupData, SyncState } from "./backup";

// The /sync payload: never includes userLessons.
export async function exportAll(): Promise<SyncState> {
  return withDb(async (db) => {
    const [cards, practiceDays, lessonCompletion] = await Promise.all([
      db.getAll("cards"),
      db.getAll("practiceDays"),
      db.getAll("lessonCompletion"),
    ]);
    return { cards, practiceDays, lessonCompletion };
  });
}

export async function exportBackupData(): Promise<BackupData> {
  return withDb(async (db) => {
    const [cards, practiceDays, lessonCompletion, userLessons] = await Promise.all([
      db.getAll("cards"),
      db.getAll("practiceDays"),
      db.getAll("lessonCompletion"),
      db.getAll("userLessons"),
    ]);
    return { cards, practiceDays, lessonCompletion, userLessons };
  });
}

export async function replaceAll(data: BackupData): Promise<void> {
  return withDb(async (db) => {
    const tx = db.transaction(
      ["cards", "practiceDays", "lessonCompletion", "userLessons"],
      "readwrite",
    );
    tx.objectStore("cards").clear();
    tx.objectStore("practiceDays").clear();
    tx.objectStore("lessonCompletion").clear();
    tx.objectStore("userLessons").clear();
    data.cards.forEach((card) => tx.objectStore("cards").put(card));
    data.practiceDays.forEach((practiceDay) =>
      tx.objectStore("practiceDays").put(practiceDay),
    );
    data.lessonCompletion.forEach((completion) =>
      tx.objectStore("lessonCompletion").put(completion),
    );
    data.userLessons.forEach((lesson) => tx.objectStore("userLessons").put(lesson));
    await tx.done;
    notifyLocalMutation();
  });
}

export async function claimOwner(ownerId: string): Promise<boolean> {
  return withDb(async (db) => {
    const tx = db.transaction("meta", "readwrite");
    const owner = await tx.objectStore("meta").get("owner");
    if (!owner) {
      tx.objectStore("meta").put({ key: "owner", ownerId });
      await tx.done;
      return true;
    }
    await tx.done;
    return owner.ownerId === ownerId;
  });
}

export async function mergeInto(data: SyncState): Promise<void> {
  return withDb(async (db) => {
    const tx = db.transaction(
      ["cards", "practiceDays", "lessonCompletion"],
      "readwrite",
    );
    const cards = tx.objectStore("cards");
    for (const incoming of data.cards) {
      const local = await cards.get(incoming.id);
      cards.put(local ? mergeCard(local, incoming) : incoming);
    }
    data.practiceDays.forEach((practiceDay) =>
      tx.objectStore("practiceDays").put(practiceDay),
    );
    data.lessonCompletion.forEach((completion) =>
      tx.objectStore("lessonCompletion").put(completion),
    );
    await tx.done;
  });
}
