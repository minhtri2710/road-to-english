import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { exportData, importData } from "./backup";
import { claimOwner, exportAll, exportBackupData, getOwner, mergeInto, replaceAll } from "./backupStore";
import {
  getCompletedLessons,
  getPracticeDays,
  markLessonComplete,
  recordPractice,
} from "./progressStore";
import { dueCards, getAllCards, putCard } from "./vocabStore";
import { createCard } from "./vocab";
import { listUserLessons, putUserLesson } from "./userLessons";
import { userLesson } from "../test/fixtures";

const now = new Date("2026-01-05T00:00:00.000Z");

function card(sentenceId: string, date = now) {
  return createCard(
    {
      front: sentenceId,
      back: `answer-${sentenceId}`,
      source: { lessonId: "lesson-1", sentenceId, word: "" },
    },
    date,
  );
}

describe("backup store", () => {
  it("round-trips all stores and keeps imported dates usable", async () => {
    const saved = card("saved");
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
    const deviceA = card("same");
    const deviceB = card("same");
    deviceB.front = "device two";
    await mergeInto({ cards: [deviceA], practiceDays: [], lessonCompletion: [] });
    await mergeInto({ cards: [deviceB], practiceDays: [], lessonCompletion: [] });

    expect(await getAllCards()).toHaveLength(1);
  });

  it("merges cards by review time and unions progress rows", async () => {
    const first = card("same");
    const second = card("same");
    second.front = "device two";
    second.fsrs.last_review = new Date("2026-01-02T00:00:00Z");
    await putCard(first);
    await mergeInto({
      cards: [second],
      practiceDays: [{ date: "2026-01-06" }],
      lessonCompletion: [{ lessonId: "lesson-2" }],
    });

    expect(await getAllCards()).toEqual([second]);
    expect(await getPracticeDays()).toEqual(["2026-01-06"]);
    expect(await getCompletedLessons()).toEqual(["lesson-2"]);
  });

  it("keeps the owner through import replacement and excludes it from export", async () => {
    await claimOwner("user-1");
    await replaceAll({ cards: [], practiceDays: [], lessonCompletion: [], userLessons: [] });

    expect(await getOwner()).toBe("user-1");
    expect(await exportAll()).toEqual({ cards: [], practiceDays: [], lessonCompletion: [] });
  });

  it("replaces rather than merges existing rows", async () => {
    await putCard(card("old"));
    await recordPractice("2026-01-04", { newCard: false });
    await markLessonComplete("old-lesson");
    await putUserLesson({ ...userLesson, id: "user-00000000-0000-4000-8000-00000000000f" });

    const imported = {
      cards: [card("new")],
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
    await mergeInto({ cards: [card("synced")], practiceDays: [], lessonCompletion: [] });

    expect(await listUserLessons()).toEqual([userLesson]);
  });

  it("keeps user lessons out of the sync payload", async () => {
    await putUserLesson(userLesson);

    expect(Object.keys(await exportAll()).sort()).toEqual(["cards", "lessonCompletion", "practiceDays"]);
    expect((await exportBackupData()).userLessons).toEqual([userLesson]);
  });
});
