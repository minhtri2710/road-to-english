import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { exportData, importData } from "./backup";
import { replaceAll, exportAll } from "./backupStore";
import {
  getCompletedLessons,
  getPracticeDays,
  markLessonComplete,
  recordPractice,
} from "./progressStore";
import { dueCards, getAllCards, putCard } from "./vocabStore";
import { createCard } from "./vocab";

const now = new Date("2026-01-05T00:00:00.000Z");

function card(sentenceId: string, date = now) {
  return createCard(
    {
      front: sentenceId,
      back: `answer-${sentenceId}`,
      source: { lessonId: "lesson-1", sentenceId },
    },
    date,
  );
}

describe("backup store", () => {
  it("round-trips all stores and keeps imported dates usable", async () => {
    const saved = card("saved");
    saved.fsrs.last_review = new Date("2026-01-04T12:00:00.000Z");
    await putCard(saved);
    await recordPractice("2026-01-05");
    await markLessonComplete("lesson-1");

    const exported = await exportAll();
    indexedDB = new IDBFactory();
    await replaceAll(importData(exportData(exported, now)));

    expect(await getAllCards()).toEqual(exported.cards);
    expect(await getPracticeDays()).toEqual(["2026-01-05"]);
    expect(await getCompletedLessons()).toEqual(["lesson-1"]);
    expect(dueCards(await getAllCards(), now)).toHaveLength(1);
    expect((await getAllCards())[0]?.fsrs.due).toBeInstanceOf(Date);
  });

  it("replaces rather than merges existing rows", async () => {
    await putCard(card("old"));
    await recordPractice("2026-01-04");
    await markLessonComplete("old-lesson");

    const imported = {
      cards: [card("new")],
      practiceDays: [{ date: "2026-01-05" }],
      lessonCompletion: [{ lessonId: "new-lesson" }],
    };
    await replaceAll(imported);

    expect((await getAllCards()).map(({ front }) => front)).toEqual(["new"]);
    expect(await getPracticeDays()).toEqual(["2026-01-05"]);
    expect(await getCompletedLessons()).toEqual(["new-lesson"]);
  });
});
