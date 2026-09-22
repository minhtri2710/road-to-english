import { openAppDatabase } from "./db";
import { newerCard } from "./newerCard";
import { notifyLocalMutation } from "./syncEvents";
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

// ponytail: no deletes, so no tombstones; adding deletion requires tombstones or rows resurrect.
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
    notifyLocalMutation();
  } finally {
    db.close();
  }
}

export async function claimOwner(ownerId: string): Promise<boolean> {
  const db = await openAppDatabase();
  try {
    const tx = db.transaction("meta", "readwrite");
    const owner = await tx.objectStore("meta").get("owner");
    if (!owner) {
      tx.objectStore("meta").put({ key: "owner", ownerId });
      await tx.done;
      return true;
    }
    await tx.done;
    return owner.ownerId === ownerId;
  } finally {
    db.close();
  }
}

export async function getOwner(): Promise<string | undefined> {
  const db = await openAppDatabase();
  try {
    return (await db.get("meta", "owner"))?.ownerId;
  } finally {
    db.close();
  }
}

export async function mergeInto(data: BackupData): Promise<void> {
  const db = await openAppDatabase();
  try {
    const tx = db.transaction(
      ["cards", "practiceDays", "lessonCompletion"],
      "readwrite",
    );
    const cards = tx.objectStore("cards");
    for (const incoming of data.cards) {
      const local = await cards.get(incoming.id);
      if (!local || newerCard(local, incoming)) {
        cards.put(incoming);
      }
    }
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
