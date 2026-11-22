import { withDb, type StoredLearnProgress } from "./db";
import {
  learnStamp,
  notifyLearnProgressChanged,
  sameLearnContent,
  shouldApplyLearnReply,
} from "./learnProgress";
import { mergeCard } from "./mergeCard";
import { notifyLocalMutation } from "./syncEvents";
import { plainCard, sameVersion } from "./vocabStore";
import type { BackupData, SyncReply, SyncSnapshot } from "./backup";

// The local snapshot a /sync request is built from: never includes userLessons.
export async function readSyncSnapshot(): Promise<SyncSnapshot> {
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

// Applies a 200 for the request that sent `sent`, in one transaction, and returns whether a follow-up sync is
// needed: the epoch mismatched, or an unsent local Learn change collided with a server row at the same instant.
// Same epoch: a card whose stored copy is still the version sent is settled; it is stored clean when the reply has it and
// deleted when the reply does not (the server purged it or never had it). A card changed during the request stays dirty.
// Mismatch (the server lost its copy): nothing is deleted and every card is marked dirty, so a follow-up sync re-pushes it.
// Every write is decided before the first one is queued, so a reply the store cannot represent leaves the whole
// reply unapplied; the request promises and the transaction itself are both awaited before this resolves.
export async function mergeInto(data: SyncReply, sent: Pick<SyncSnapshot, "cards" | "learnProgress">): Promise<boolean> {
  return withDb(async (db) => {
    const tx = db.transaction(
      ["cards", "practiceDays", "lessonCompletion", "learnProgress", "meta"],
      "readwrite",
    );
    const apply = async () => {
      const cards = tx.objectStore("cards");
      const meta = tx.objectStore("meta");
      const progressStore = tx.objectStore("learnProgress");
      const [locals, epochRecord, progressRows] = await Promise.all([
        cards.getAll(),
        meta.get("syncEpoch"),
        progressStore.getAll(),
      ]);
      // Each lesson's newer Learn progress wins; a local copy the reply does not have is pushed by the next sync.
      const localProgress = new Map(progressRows.map((progress) => [progress.lessonId, progress]));
      const sentLearn = new Map(sent.learnProgress.map((progress) => [progress.lessonId, progress]));
      const learnWrites: StoredLearnProgress[] = [];
      let progressChanged = false;
      let repush = false;
      for (const remote of data.learnProgress) {
        const local = localProgress.get(remote.lessonId);
        if (
          local &&
          Date.parse(remote.updatedAt) === Date.parse(local.updatedAt) &&
          !sameLearnContent(local, remote)
        ) {
          const prior = sentLearn.get(remote.lessonId);
          const changedAfterSend =
            !prior || Date.parse(prior.updatedAt) !== Date.parse(local.updatedAt) || !sameLearnContent(prior, local);
          if (changedAfterSend) {
            // A local change the request did not carry collides at the reply's instant: restamp it one tick
            // later and let the next sync push it instead of silently losing it to the server copy.
            learnWrites.push({ ...local, updatedAt: learnStamp(new Date(local.updatedAt), local.updatedAt) });
            repush = true;
            continue;
          }
        }
        if (shouldApplyLearnReply(local, remote)) {
          learnWrites.push(remote);
          progressChanged = true;
        }
      }

      const storedEpoch = epochRecord && "epoch" in epochRecord ? epochRecord.epoch : undefined;
      const mismatch = storedEpoch === undefined ? locals.some((card) => !card.dirty) : storedEpoch !== data.syncEpoch;
      const incoming = new Map(data.cards.map((card) => [card.id, card]));
      const sentById = new Map(sent.cards.map((card) => [card.id, card]));
      const writes: Promise<unknown>[] = [];
      for (const local of locals) {
        const remote = incoming.get(local.id);
        incoming.delete(local.id);
        const sentCopy = sentById.get(local.id);
        const settled = !mismatch && sentCopy !== undefined && sentCopy.dirty === local.dirty && sameVersion(local, sentCopy);
        // Settled cards take the server's canonical copy; an unsettled local change still merges local-first.
        const merged = remote ? (settled ? mergeCard(remote, local) : mergeCard(local, remote)) : local;
        if (remote || !settled) {
          writes.push(cards.put({ ...merged, dirty: !settled }));
        } else {
          writes.push(cards.delete(local.id));
        }
      }
      for (const remote of incoming.values()) {
        writes.push(cards.put({ ...remote, dirty: mismatch }));
      }
      writes.push(meta.put({ key: "syncEpoch", epoch: data.syncEpoch }));
      data.practiceDays.forEach((practiceDay) =>
        writes.push(tx.objectStore("practiceDays").put(practiceDay)),
      );
      data.lessonCompletion.forEach((completion) =>
        writes.push(tx.objectStore("lessonCompletion").put(completion)),
      );
      learnWrites.forEach((progress) => writes.push(progressStore.put(progress)));
      await Promise.all(writes);
      return { needsSync: mismatch || repush, progressChanged };
    };
    const [result] = await Promise.all([apply(), tx.done]);
    if (result.progressChanged) notifyLearnProgressChanged();
    return result.needsSync;
  });
}
