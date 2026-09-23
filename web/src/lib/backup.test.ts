import { describe, expect, it } from "vitest";

import { backupFileName, exportData, importData } from "./backup";
import { createCard } from "./vocab";
import { userLesson } from "../test/fixtures";

const now = new Date("2026-01-05T00:00:00.000Z");

function backupState() {
  const first = createCard(
    {
      front: "hello",
      back: "hola",
      source: { lessonId: "lesson-1", sentenceId: "sentence-1", word: "" },
    },
    now,
  );
  const second = createCard(
    {
      front: "goodbye",
      back: "adiós",
      source: { lessonId: "lesson-2", sentenceId: "sentence-2", word: "" },
    },
    now,
  );
  const word = createCard(
    {
      front: "Hello",
      back: "hello there — xin chào",
      source: { lessonId: "lesson-1", sentenceId: "sentence-1", word: "hello" },
    },
    now,
  );
  const lastReview = new Date("2026-01-04T12:00:00.000Z");
  second.fsrs.last_review = lastReview;

  return {
    cards: [first, second, word],
    practiceDays: [{ date: "2026-01-05" }],
    lessonCompletion: [{ lessonId: "lesson-1" }],
    userLessons: [userLesson],
  };
}

describe("backup", () => {
  it("round-trips all stores and revives FSRS dates", () => {
    const state = backupState();
    const imported = importData(exportData(state, new Date(2026, 0, 5)));

    expect(imported.cards).toHaveLength(state.cards.length);
    expect(imported.cards[0]?.fsrs.due).toBeInstanceOf(Date);
    expect(imported.cards[0]?.fsrs.due.getTime()).toBe(state.cards[0]?.fsrs.due.getTime());
    expect(imported.cards[1]?.fsrs.last_review).toBeInstanceOf(Date);
    expect(imported.cards[1]?.fsrs.last_review?.getTime()).toBe(
      state.cards[1]?.fsrs.last_review?.getTime(),
    );
    expect(JSON.parse(JSON.stringify(imported.cards))).toEqual(
      JSON.parse(JSON.stringify(state.cards)),
    );
    expect(imported.cards[2]?.id).toBe("lesson-1:sentence-1:hello");
    expect(imported.cards[2]?.source.word).toBe("hello");
    expect(imported.practiceDays).toEqual(state.practiceDays);
    expect(imported.lessonCompletion).toEqual(state.lessonCompletion);
    expect(imported.userLessons).toEqual([userLesson]);
    expect(JSON.parse(exportData(state, new Date(2026, 0, 5))).exportedAt).toBeDefined();
  });

  it.each([
    ["version", { ...backupState(), version: 2 }],
    ["missing store", { version: 1, cards: backupState().cards, practiceDays: backupState().practiceDays }],
    ["cards not array", { ...backupState(), cards: {} }],
    [
      "invalid due",
      {
        ...backupState(),
        cards: [{ ...backupState().cards[0], fsrs: { ...backupState().cards[0]?.fsrs, due: "not-a-date" } }],
      },
    ],
    ["malformed practice day", { ...backupState(), practiceDays: [{ date: "2026-1-5" }] }],
    ["missing userLessons", { ...backupState(), userLessons: undefined }],
    ["bad user lesson id", { ...backupState(), userLessons: [{ ...userLesson, id: "user-1" }] }],
    ["unprefixed user lesson id", { ...backupState(), userLessons: [{ ...userLesson, id: userLesson.id.slice(5) }] }],
    ["duplicate user lesson", { ...backupState(), userLessons: [userLesson, userLesson] }],
    ["empty title", { ...backupState(), userLessons: [{ ...userLesson, title: " " }] }],
    ["long title", { ...backupState(), userLessons: [{ ...userLesson, title: "x".repeat(101) }] }],
    ["bad level", { ...backupState(), userLessons: [{ ...userLesson, level: "C1" }] }],
    ["bad WPM", { ...backupState(), userLessons: [{ ...userLesson, targetWpm: 100 }] }],
    ["non-empty vi", { ...backupState(), userLessons: [{ ...userLesson, sentences: [{ id: "s1", text: "Hi.", vi: "Chào." }] }] }],
    [
      "out-of-order sentence ids",
      { ...backupState(), userLessons: [{ ...userLesson, sentences: [...userLesson.sentences].reverse() }] },
    ],
    ["empty sentence text", { ...backupState(), userLessons: [{ ...userLesson, sentences: [{ id: "s1", text: "", vi: "" }] }] }],
    ["no sentences", { ...backupState(), userLessons: [{ ...userLesson, sentences: [] }] }],
    ["extra lesson key", { ...backupState(), userLessons: [{ ...userLesson, extra: 1 }] }],
  ])("rejects %s", (_name, value) => {
    expect(() => importData(JSON.stringify({ version: 1, exportedAt: now.toISOString(), ...value }))).toThrow();
  });

  it("uses the injected date in the file name", () => {
    expect(backupFileName(new Date(2026, 0, 5))).toContain("2026-01-05");
  });
});
