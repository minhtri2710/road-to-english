import { withDb, type StoredCard } from "./db";
import { newerLearnProgress, notifyLearnProgressChanged } from "./learnProgress";
import { mergeCard } from "./mergeCard";
import { notifyLocalMutation } from "./syncEvents";
import { plainCard, sameVersion } from "./vocabStore";
import type { BackupData, SyncReply, SyncRequest } from "./backup";

// The /sync payload: never includes userLessons.
export async function exportAll(): Promise<SyncRequest> {
  return withDb(async (db) => {
    const tx = db.transaction(["cards", "practiceDays", "lessonCompletion", "learnProgress"], "readonly");
    const [cards, practiceDays, lessonCompletion, learnProgress] = await Promise.all([
      tx.objectStore("cards").getAll(),
      tx.objectStore("practiceDays").getAll(),
      tx.objectStore("lessonCompletion").getAll(),
      tx.objectStore("learnProgress").getAll(),
    ]);
    await tx.done;
    return { cards, practiceDays, lessonCompletion, learnProgress };
  });
}

export async function exportBackupData(): Promise<BackupData> {
  return withDb(async (db) => {
    const tx = db.transaction(
      ["cards", "practiceDays", "lessonCompletion", "learnProgress", "userLessons"],
      "readonly",
    );
    const [cards, practiceDays, lessonCompletion, learnProgress, userLessons] = await Promise.all([
      tx.objectStore("cards").getAll(),
      tx.objectStore("practiceDays").getAll(),
      tx.objectStore("lessonCompletion").getAll(),
      tx.objectStore("learnProgress").getAll(),
      tx.objectStore("userLessons").getAll(),
    ]);
    await tx.done;
    return { cards: cards.map(plainCard), practiceDays, lessonCompletion, learnProgress, userLessons };
  });
}

export async function replaceAll(data: BackupData): Promise<void> {
  return withDb(async (db) => {
    const tx = db.transaction(
      ["cards", "practiceDays", "lessonCompletion", "learnProgress", "userLessons"],
      "readwrite",
    );
    tx.objectStore("cards").clear();
    tx.objectStore("practiceDays").clear();
    tx.objectStore("lessonCompletion").clear();
    tx.objectStore("learnProgress").clear();
    tx.objectStore("userLessons").clear();
    // Every imported card is dirty, so the next sync pushes it, even one the server purged.
    data.cards.forEach((card) => tx.objectStore("cards").put({ ...card, dirty: true }));
    data.practiceDays.forEach((practiceDay) =>
      tx.objectStore("practiceDays").put(practiceDay),
    );
    data.lessonCompletion.forEach((completion) =>
      tx.objectStore("lessonCompletion").put(completion),
    );
    data.learnProgress.forEach((progress) => tx.objectStore("learnProgress").put(progress));
    data.userLessons.forEach((lesson) => tx.objectStore("userLessons").put(lesson));
    await tx.done;
    notifyLearnProgressChanged();
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
    return "ownerId" in owner && owner.ownerId === ownerId;
  });
}

// Applies a 200 for the request that sent `sent`, in one transaction, and returns whether the epoch mismatched.
// Same epoch: a card whose stored copy is still the version sent is settled; it is stored clean when the reply has it and
// deleted when the reply does not (the server purged it or never had it). A card changed during the request stays dirty.
// Mismatch (the server lost its copy): nothing is deleted and every card is marked dirty, so a follow-up sync re-pushes it.
export async function mergeInto(data: SyncReply, sent: StoredCard[]): Promise<boolean> {
  return withDb(async (db) => {
    const tx = db.transaction(
      ["cards", "practiceDays", "lessonCompletion", "learnProgress", "meta"],
      "readwrite",
    );
    const cards = tx.objectStore("cards");
    const meta = tx.objectStore("meta");
    const [locals, epochRecord] = await Promise.all([cards.getAll(), meta.get("syncEpoch")]);
    const storedEpoch = epochRecord && "epoch" in epochRecord ? epochRecord.epoch : undefined;
    const mismatch = storedEpoch === undefined ? locals.some((card) => !card.dirty) : storedEpoch !== data.syncEpoch;
    const incoming = new Map(data.cards.map((card) => [card.id, card]));
    const sentById = new Map(sent.map((card) => [card.id, card]));
    for (const local of locals) {
      const remote = incoming.get(local.id);
      incoming.delete(local.id);
      const merged = remote ? mergeCard(local, remote) : local;
      const sentCopy = sentById.get(local.id);
      const settled = !mismatch && sentCopy !== undefined && sameVersion(local, sentCopy);
      if (remote || !settled) {
        cards.put({ ...merged, dirty: !settled });
      } else {
        cards.delete(local.id);
      }
    }
    for (const remote of incoming.values()) {
      cards.put({ ...remote, dirty: mismatch });
    }
    meta.put({ key: "syncEpoch", epoch: data.syncEpoch });
    data.practiceDays.forEach((practiceDay) =>
      tx.objectStore("practiceDays").put(practiceDay),
    );
    data.lessonCompletion.forEach((completion) =>
      tx.objectStore("lessonCompletion").put(completion),
    );
    // Each lesson's newer Learn progress wins; a local copy the reply does not have is pushed by the next sync.
    const progressStore = tx.objectStore("learnProgress");
    const localProgress = new Map((await progressStore.getAll()).map((progress) => [progress.lessonId, progress]));
    let progressChanged = false;
    for (const remote of data.learnProgress) {
      if (newerLearnProgress(localProgress.get(remote.lessonId), remote)) {
        progressStore.put(remote);
        progressChanged = true;
      }
    }
    await tx.done;
    if (progressChanged) notifyLearnProgressChanged();
    return mismatch;
  });
}
