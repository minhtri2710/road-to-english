import { describe, expect, it } from "vitest";

import {
  createUserLesson,
  deleteUserLesson,
  getUserLesson,
  isValidUserLesson,
  listUserLessons,
  putUserLesson,
  segmentText,
} from "./userLessons";
import { userLesson } from "../test/fixtures";

describe("segmentText", () => {
  it("splits multiple sentences", () => {
    expect(segmentText("I like tea. Do you? Yes!")).toEqual(["I like tea.", "Do you?", "Yes!"]);
  });

  it("collapses whitespace and newlines", () => {
    expect(segmentText("  I   like\n\ttea.\n\nYou  like coffee.  ")).toEqual([
      "I like tea.",
      "You like coffee.",
    ]);
  });

  it("treats a blank line as a hard break", () => {
    expect(segmentText("Chapter 1\n\nThe cat sat.")).toEqual(["Chapter 1", "The cat sat."]);
    expect(segmentText("Chapter 1\n  \t\n  The cat sat.")).toEqual(["Chapter 1", "The cat sat."]);
  });

  it("joins a hard-wrapped sentence", () => {
    expect(segmentText("The cat\nsat on\nthe mat.")).toEqual(["The cat sat on the mat."]);
  });

  it("keeps quotes with their sentence", () => {
    expect(segmentText('She said "hello." Then she left.')).toEqual([
      'She said "hello."',
      "Then she left.",
    ]);
  });

  it("splits after an abbreviation (documented best-effort)", () => {
    expect(segmentText("Mr. Smith is here.")).toEqual(["Mr.", "Smith is here."]);
  });

  it("drops segments with no card word", () => {
    expect(segmentText("Hello. «»? Bye.")).toEqual(["Hello.", "Bye."]);
  });

  it("returns [] for empty text", () => {
    expect(segmentText("")).toEqual([]);
    expect(segmentText("   \n ")).toEqual([]);
  });
});

describe("createUserLesson", () => {
  it("builds a valid lesson", () => {
    const lesson = createUserLesson({ title: "  Mine ", text: "One. Two.", level: "B2", targetWpm: 130 });

    expect(isValidUserLesson(lesson)).toBe(true);
    expect(lesson).toMatchObject({
      title: "Mine",
      level: "B2",
      targetWpm: 130,
      sentences: [
        { id: "s1", text: "One.", vi: "" },
        { id: "s2", text: "Two.", vi: "" },
      ],
    });
  });

  it.each([
    ["empty title", { title: " ", text: "One." }],
    ["long title", { title: "x".repeat(101), text: "One." }],
    ["long text", { title: "t", text: "a".repeat(20001) }],
    ["no sentences", { title: "t", text: "..." }],
    ["too many sentences", { title: "t", text: "Go. ".repeat(201) }],
    ["NUL in title", { title: "t\u0000", text: "One." }],
    ["NUL in text", { title: "t", text: "On\u0000e." }],
  ])("rejects %s", (_name, input) => {
    expect(() => createUserLesson({ ...input, level: "B1", targetWpm: 110 })).toThrow();
  });

  it("rejects NUL in a stored title or sentence", () => {
    expect(isValidUserLesson(userLesson)).toBe(true);
    expect(isValidUserLesson({ ...userLesson, title: "My\u0000text" })).toBe(false);
    expect(isValidUserLesson({ ...userLesson, sentences: [{ id: "s1", text: "I like\u0000 tea.", vi: "" }] })).toBe(false);
  });

  it("accepts the limits", () => {
    expect(createUserLesson({ title: "x".repeat(100), text: "Go. ".repeat(200), level: "B1", targetWpm: 110 }).sentences).toHaveLength(200);
  });
});

describe("user lesson store", () => {
  it("round-trips put, get, list and delete", async () => {
    const other = { ...userLesson, id: "user-00000000-0000-4000-8000-000000000002", title: "Other" };
    await putUserLesson(userLesson);
    await putUserLesson(other);

    expect(await getUserLesson(userLesson.id)).toEqual(userLesson);
    expect(await listUserLessons()).toEqual([userLesson, other]);

    await deleteUserLesson(userLesson.id);

    expect(await getUserLesson(userLesson.id)).toBeUndefined();
    expect(await listUserLessons()).toEqual([other]);
  });
});
