import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";

import { exportData, importData } from "./backup";
import { claimOwner, exportAll, exportBackupData, mergeInto, replaceAll } from "./backupStore";
import { withDb } from "./db";
import { onLearnProgressChanged } from "./learnProgress";
import {
  getCompletedLessons,
  getPracticeDays,
  markLessonComplete,
  recordPractice,
} from "./progressStore";
import { deleteCard } from "./vocab";
import { dueCards, getAllCards, putCard } from "./vocabStore";
import { listUserLessons, putUserLesson } from "./userLessons";
import { card, userLesson } from "../test/fixtures";

const now = new Date("2026-01-05T00:00:00.000Z");
const SYNC_EPOCH = "epoch-1";

type SnapshotStore = "cards" | "practiceDays" | "lessonCompletion" | "userLessons";

async function expectConsistentExport<T extends {
  cards: { id: string }[];
  practiceDays: { date: string }[];
  lessonCompletion: { lessonId: string }[];
  userLessons?: { id: string }[];
}>(exportSnapshot: () => Promise<T>, stores: readonly SnapshotStore[]): Promise<void> {
  const transaction = IDBDatabase.prototype.transaction;
  let writeQueued = false;
  let writeComplete: Promise<void> | undefined;
  const openTransaction = vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(function (
    this: IDBDatabase,
    ...args
  ) {
    const tx = transaction.apply(this, args);
    if (!writeQueued && args[1] === "readonly") {
      writeQueued = true;
      const writer = transaction.call(this, [...stores], "readwrite");
      writer.objectStore("cards").put({ ...card("snapshot", now), dirty: true });
      writer.objectStore("practiceDays").put({ date: "2026-01-06" });
      writer.objectStore("lessonCompletion").put({ lessonId: "snapshot-lesson" });
      if (stores.includes("userLessons")) {
        writer.objectStore("userLessons").put({
          ...userLesson,
          id: "user-00000000-0000-4000-8000-00000000000f",
        });
      }
      writeComplete = new Promise((resolve, reject) => {
        writer.addEventListener("complete", () => resolve(), { once: true });
        writer.addEventListener("abort", () => reject(writer.error), { once: true });
      });
    }
    return tx;
  });

  try {
    const exported = await exportSnapshot();
    await writeComplete;
    expect(writeQueued).toBe(true);
    const writePresence = [
      exported.cards.some(({ id }) => id === "lesson-1:snapshot"),
      exported.practiceDays.some(({ date }) => date === "2026-01-06"),
      exported.lessonCompletion.some(({ lessonId }) => lessonId === "snapshot-lesson"),
      ...(stores.includes("userLessons")
        ? [exported.userLessons?.some(({ id }) => id === "user-00000000-0000-4000-8000-00000000000f") ?? false]
        : []),
    ];
    expect(new Set(writePresence).size).toBe(1);
  } finally {
    openTransaction.mockRestore();
  }
}

describe("backup store", () => {
  it("round-trips all stores and keeps imported dates usable", async () => {
    const saved = card("saved", now);
    saved.fsrs.last_review = new Date("2026-01-04T12:00:00.000Z");
    await putCard(saved);
    await recordPractice("2026-01-05", { newCard: false });
    await markLessonComplete("lesson-1");
    await putUserLesson(userLesson);

    const exported = await exportBackupData();
    indexedDB = new IDBFactory();
    await replaceAll(importData(exportData(exported, now)));

    expect(await getAllCards()).toEqual(exported.cards);
    expect(await getPracticeDays()).toEqual(["2026-01-05"]);
    expect(await getCompletedLessons()).toEqual(["lesson-1"]);
    expect(await listUserLessons()).toEqual([userLesson]);
    expect(dueCards(await getAllCards(), now)).toHaveLength(1);
    expect((await getAllCards())[0]?.fsrs.due).toBeInstanceOf(Date);
  });

  it("round-trips a tombstone through export and import", async () => {
    const tombstone = deleteCard(card("gone", now), new Date("2026-01-06T00:00:00.000Z"));
    await putCard(tombstone);
    await putCard(card("kept", now));

    const exported = await exportBackupData();
    indexedDB = new IDBFactory();
    await replaceAll(importData(exportData(exported, now)));

    expect(await getAllCards()).toEqual(exported.cards);
    expect((await getAllCards()).find(({ id }) => id === tombstone.id)?.deletedAt).toBe(tombstone.deletedAt);
    expect(dueCards(await getAllCards(), now).map(({ front }) => front)).toEqual(["kept"]);
  });

  it("replaces rather than merges existing rows", async () => {
    await putCard(card("old", now));
    await recordPractice("2026-01-04", { newCard: false });
    await markLessonComplete("old-lesson");
    await putUserLesson({ ...userLesson, id: "user-00000000-0000-4000-8000-00000000000f" });

    const imported = {
      cards: [card("new", now)],
      practiceDays: [{ date: "2026-01-05" }],
      lessonCompletion: [{ lessonId: "new-lesson" }], learnProgress: [],
      userLessons: [userLesson],
    };
    await replaceAll(imported);

    expect((await getAllCards()).map(({ front }) => front)).toEqual(["new"]);
    expect(await getPracticeDays()).toEqual(["2026-01-05"]);
    expect(await getCompletedLessons()).toEqual(["new-lesson"]);
    expect(await listUserLessons()).toEqual([userLesson]);
  });

  it("keeps the owner through import replacement and excludes it from export", async () => {
    await claimOwner("user-1");
    await replaceAll({ cards: [], practiceDays: [], lessonCompletion: [], learnProgress: [], userLessons: [] });

    expect(await claimOwner("user-2")).toBe(false);
    expect(await claimOwner("user-1")).toBe(true);
    expect(await exportAll()).toEqual({ cards: [], practiceDays: [], lessonCompletion: [], learnProgress: [] });
  });

  it("merges sync state by updatedAt and unions progress rows", async () => {
    const first = card("same", now);
    const second = card("same", new Date("2026-01-06T00:00:00.000Z"));
    second.front = "device two";
    await putCard(first);
    await mergeInto({
      cards: [second],
      practiceDays: [{ date: "2026-01-06" }],
      lessonCompletion: [{ lessonId: "lesson-2" }], learnProgress: [],
      syncEpoch: SYNC_EPOCH,
    }, []);

    expect(await getAllCards()).toEqual([second]);
    expect(await getPracticeDays()).toEqual(["2026-01-06"]);
    expect(await getCompletedLessons()).toEqual(["lesson-2"]);
  });

  it("merges sync state without touching user lessons", async () => {
    await putUserLesson(userLesson);
    await mergeInto({ cards: [card("synced", now)], practiceDays: [], lessonCompletion: [], learnProgress: [], syncEpoch: SYNC_EPOCH }, []);

    expect(await listUserLessons()).toEqual([userLesson]);
  });

  it("merges Learn progress from a sync reply: the newer copy of each lesson wins", async () => {
    await withDb(async (db) => {
      await db.put("learnProgress", { lessonId: "kept", passed: ["s1"], skipsUsed: 0, updatedAt: "2026-09-22T12:00:00.000Z" });
      await db.put("learnProgress", { lessonId: "replaced", passed: ["s1"], skipsUsed: 0, updatedAt: "2026-09-22T10:00:00.000Z" });
    });
    let changed = 0;
    const stop = onLearnProgressChanged(() => changed++);
    await mergeInto(
      {
        cards: [],
        practiceDays: [],
        lessonCompletion: [],
        learnProgress: [
          { lessonId: "kept", passed: [], skipsUsed: 0, updatedAt: "2026-09-22T11:00:00.000Z" },
          { lessonId: "replaced", passed: [], skipsUsed: 2, updatedAt: "2026-09-22T11:00:00.000Z" },
          { lessonId: "new", passed: ["s9"], skipsUsed: 0, updatedAt: "2026-09-22T11:00:00.000Z" },
        ],
        syncEpoch: "epoch",
      },
      [],
    );
    stop();
    const stored = await withDb((db) => db.getAll("learnProgress"));
    expect(Object.fromEntries(stored.map((progress) => [progress.lessonId, progress.passed]))).toEqual({
      kept: ["s1"],
      new: ["s9"],
      replaced: [],
    });
    expect(changed).toBe(1);
  });

  it("puts Learn progress in the backup and replaces it on import", async () => {
    await withDb((db) => db.put("learnProgress", { lessonId: "old", passed: ["s1"], skipsUsed: 0, updatedAt: "2026-09-22T10:00:00.000Z" }));
    expect((await exportBackupData()).learnProgress.map(({ lessonId }) => lessonId)).toEqual(["old"]);
    const imported = { lessonId: "imported", passed: ["s2"], skipsUsed: 1, updatedAt: "2026-09-23T10:00:00.000Z" };
    await replaceAll({ cards: [], practiceDays: [], lessonCompletion: [], learnProgress: [imported], userLessons: [] });
    expect(await withDb((db) => db.getAll("learnProgress"))).toEqual([imported]);
  });

  it("keeps user lessons out of the sync payload", async () => {
    await putUserLesson(userLesson);

    expect(Object.keys(await exportAll()).sort()).toEqual(["cards", "learnProgress", "lessonCompletion", "practiceDays"]);
    expect((await exportBackupData()).userLessons).toEqual([userLesson]);
  });

  it("exportAll reads a consistent snapshot during a concurrent write", async () => {
    await expectConsistentExport(exportAll, ["cards", "practiceDays", "lessonCompletion"]);
  });

  it("exportBackupData reads a consistent snapshot during a concurrent write", async () => {
    await expectConsistentExport(exportBackupData, [
      "cards",
      "practiceDays",
      "lessonCompletion",
      "userLessons",
    ]);
  });
});

// W2: the request carries each card's stored dirty flag; the backup never does.
describe("dirty flag on export", () => {
  it("exportAll carries dirty; exportBackupData and exportData do not", async () => {
    const synced = card("synced", now);
    await mergeInto({ cards: [synced], practiceDays: [], lessonCompletion: [], learnProgress: [], syncEpoch: SYNC_EPOCH }, []);
    await putCard(card("local", now));

    expect((await exportAll()).cards.map(({ id, dirty }) => [id, dirty])).toEqual([["lesson-1:local", true], ["lesson-1:synced", false]]);
    const backup = await exportBackupData();
    expect(backup.cards.every((stored) => !("dirty" in stored))).toBe(true);
    expect(exportData(backup, now)).not.toContain("dirty");
  });
});
