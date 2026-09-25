import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { exportData, importData } from "./backup";
import { claimOwner, exportAll, exportBackupData, mergeInto, replaceAll } from "./backupStore";
import {
  getCompletedLessons,
  getPracticeDays,
  markLessonComplete,
  recordPractice,
} from "./progressStore";
import { dueCards, getAllCards, putCard } from "./vocabStore";
import { deleteCard, Rating, restoreCard, reviewCard } from "./vocab";
import { listUserLessons, putUserLesson } from "./userLessons";
import { card, userLesson } from "../test/fixtures";

const now = new Date("2026-01-05T00:00:00.000Z");
const SYNC_EPOCH = "epoch-1";

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

  it("merges two devices saving the same sentence into one deterministic card", async () => {
    const deviceA = card("same", now);
    const deviceB = card("same", now);
    deviceB.front = "device two";
    await mergeInto({ cards: [deviceA], practiceDays: [], lessonCompletion: [], syncEpoch: SYNC_EPOCH }, []);
    await mergeInto({ cards: [deviceB], practiceDays: [], lessonCompletion: [], syncEpoch: SYNC_EPOCH }, []);

    expect(await getAllCards()).toHaveLength(1);
  });

  it("resolves two devices saving the same new card to the later updatedAt", async () => {
    const deviceA = card("same", new Date("2026-01-05T00:00:01.000Z"));
    const deviceB = card("same", new Date("2026-01-05T00:00:00.000Z"));
    deviceA.front = "device A";
    await mergeInto({ cards: [deviceA], practiceDays: [], lessonCompletion: [], syncEpoch: SYNC_EPOCH }, []);
    await mergeInto({ cards: [deviceB], practiceDays: [], lessonCompletion: [], syncEpoch: SYNC_EPOCH }, []);
    expect(await getAllCards()).toEqual([deviceA]);

    indexedDB = new IDBFactory();
    await mergeInto({ cards: [deviceB], practiceDays: [], lessonCompletion: [], syncEpoch: SYNC_EPOCH }, []);
    await mergeInto({ cards: [deviceA], practiceDays: [], lessonCompletion: [], syncEpoch: SYNC_EPOCH }, []);
    expect(await getAllCards()).toEqual([deviceA]);
  });

  it("never resurrects a local delete from an older live copy", async () => {
    const live = card("same", now);
    const tombstone = deleteCard(live, new Date("2026-01-06T00:00:00.000Z"));
    await putCard(tombstone);
    await mergeInto({ cards: [live], practiceDays: [], lessonCompletion: [], syncEpoch: SYNC_EPOCH }, []);

    expect(await getAllCards()).toEqual([tombstone]);
  });

  it("lets an undo or re-save after a synced delete replace the remote tombstone", async () => {
    const live = card("same", now);
    const remoteTombstone = deleteCard(live, new Date("2026-01-06T00:00:00.000Z"));
    const undone = restoreCard(live, new Date("2026-01-07T00:00:00.000Z"));
    await putCard(undone);
    await mergeInto({ cards: [remoteTombstone], practiceDays: [], lessonCompletion: [], syncEpoch: SYNC_EPOCH }, []);
    expect(await getAllCards()).toEqual([undone]);

    const resaved = card("same", new Date("2026-01-08T00:00:00.000Z"));
    await putCard(remoteTombstone);
    await mergeInto({ cards: [resaved], practiceDays: [], lessonCompletion: [], syncEpoch: SYNC_EPOCH }, []);
    expect(await getAllCards()).toEqual([resaved]);
  });

  it("keeps local review history when a newer fresh save syncs in", async () => {
    const reviewed = reviewCard(card("same", now), Rating.Good, new Date("2026-01-06T00:00:00.000Z"));
    await putCard(reviewed);
    const staleSave = card("same", new Date("2026-01-07T00:00:00.000Z"));
    await mergeInto({ cards: [staleSave], practiceDays: [], lessonCompletion: [], syncEpoch: SYNC_EPOCH }, []);

    expect(await getAllCards()).toEqual([{ ...staleSave, fsrs: reviewed.fsrs }]);
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

  it("merges cards by updatedAt and unions progress rows", async () => {
    const first = card("same", now);
    const second = card("same", new Date("2026-01-06T00:00:00.000Z"));
    second.front = "device two";
    await putCard(first);
    await mergeInto({
      cards: [second],
      practiceDays: [{ date: "2026-01-06" }],
      lessonCompletion: [{ lessonId: "lesson-2" }],
      syncEpoch: SYNC_EPOCH,
    }, []);

    expect(await getAllCards()).toEqual([second]);
    expect(await getPracticeDays()).toEqual(["2026-01-06"]);
    expect(await getCompletedLessons()).toEqual(["lesson-2"]);
  });

  it("keeps the owner through import replacement and excludes it from export", async () => {
    await claimOwner("user-1");
    await replaceAll({ cards: [], practiceDays: [], lessonCompletion: [], userLessons: [] });

    expect(await claimOwner("user-2")).toBe(false);
    expect(await claimOwner("user-1")).toBe(true);
    expect(await exportAll()).toEqual({ cards: [], practiceDays: [], lessonCompletion: [] });
  });

  it("replaces rather than merges existing rows", async () => {
    await putCard(card("old", now));
    await recordPractice("2026-01-04", { newCard: false });
    await markLessonComplete("old-lesson");
    await putUserLesson({ ...userLesson, id: "user-00000000-0000-4000-8000-00000000000f" });

    const imported = {
      cards: [card("new", now)],
      practiceDays: [{ date: "2026-01-05" }],
      lessonCompletion: [{ lessonId: "new-lesson" }],
      userLessons: [userLesson],
    };
    await replaceAll(imported);

    expect((await getAllCards()).map(({ front }) => front)).toEqual(["new"]);
    expect(await getPracticeDays()).toEqual(["2026-01-05"]);
    expect(await getCompletedLessons()).toEqual(["new-lesson"]);
    expect(await listUserLessons()).toEqual([userLesson]);
  });

  it("merges sync state without touching user lessons", async () => {
    await putUserLesson(userLesson);
    await mergeInto({ cards: [card("synced", now)], practiceDays: [], lessonCompletion: [], syncEpoch: SYNC_EPOCH }, []);

    expect(await listUserLessons()).toEqual([userLesson]);
  });

  it("keeps user lessons out of the sync payload", async () => {
    await putUserLesson(userLesson);

    expect(Object.keys(await exportAll()).sort()).toEqual(["cards", "lessonCompletion", "practiceDays"]);
    expect((await exportBackupData()).userLessons).toEqual([userLesson]);
  });
});

// W2: the request carries each card's stored dirty flag; the backup never does.
describe("dirty flag on export", () => {
  it("exportAll carries dirty; exportBackupData and exportData do not", async () => {
    const synced = card("synced", now);
    await mergeInto({ cards: [synced], practiceDays: [], lessonCompletion: [], syncEpoch: SYNC_EPOCH }, []);
    await putCard(card("local", now));

    expect((await exportAll()).cards.map(({ id, dirty }) => [id, dirty])).toEqual([["lesson-1:local", true], ["lesson-1:synced", false]]);
    const backup = await exportBackupData();
    expect(backup.cards.every((stored) => !("dirty" in stored))).toBe(true);
    expect(exportData(backup, now)).not.toContain("dirty");
  });
});
