import { describe, expect, it } from "vitest";

import {
  createUserLesson,
  deleteUserLesson,
  isValidUserLesson,
  listUserLessons,
  putUserLesson,
} from "./userLessons";
import { userLesson, videoLesson } from "../test/fixtures";

function segmentText(text: string): string[] {
  return createUserLesson({ title: "T", text, level: "B1", targetWpm: 110 }).sentences.map((sentence) => sentence.text);
}

describe("sentence segmentation", () => {
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

  it("finds no sentence in empty text", () => {
    expect(() => segmentText("")).toThrow("Text must contain 1-200 sentences.");
    expect(() => segmentText("   \n ")).toThrow("Text must contain 1-200 sentences.");
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

  it("accepts an A1 lesson and rejects an unknown level", () => {
    const lesson = createUserLesson({ title: "Mine", text: "One.", level: "A1", targetWpm: 90 });

    expect(isValidUserLesson(lesson)).toBe(true);
    expect(isValidUserLesson({ ...lesson, level: "C1" })).toBe(false);
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

describe("video lessons", () => {
  const cueTranscript = (count: number) =>
    Array.from({ length: count }, (_, i) => `${Math.floor(i / 60)}:${String(i % 60).padStart(2, "0")}\nGo.`).join("\n");
  const transcript = "0:00\nI like tea.\n0:02\nYou like\ncoffee.\n1:05\nWe drink it daily.";

  it("builds a valid video lesson from a URL and a transcript", () => {
    const lesson = createUserLesson({
      title: "Tea video",
      text: transcript,
      level: "B1",
      targetWpm: 110,
      videoUrl: "https://youtu.be/dQw4w9WgXcQ",
    });

    expect(isValidUserLesson(lesson)).toBe(true);
    expect(lesson).toMatchObject({
      videoId: "dQw4w9WgXcQ",
      sentences: [
        { id: "s1", text: "I like tea.", vi: "", cue: { start: 0, end: 2 } },
        { id: "s2", text: "You like coffee.", vi: "", cue: { start: 2, end: 65 } },
        { id: "s3", text: "We drink it daily.", vi: "", cue: { start: 65, end: null } },
      ],
    });
  });

  it("keeps a plain lesson free of video keys", () => {
    const lesson = createUserLesson({ title: "t", text: "One.", level: "B1", targetWpm: 110, videoUrl: "" });

    expect(Object.keys(lesson)).not.toContain("videoId");
    expect(Object.keys(lesson.sentences[0]!)).toEqual(["id", "vi", "text"]);
  });

  it.each([
    ["bad URL", "https://vimeo.com/123", transcript],
    ["transcript without cues", "https://youtu.be/dQw4w9WgXcQ", "0:00\n0:05"],
    ["leading text", "https://youtu.be/dQw4w9WgXcQ", "Hello\n0:00\nHi."],
    ["too many cues", "https://youtu.be/dQw4w9WgXcQ", cueTranscript(201)],
  ])("rejects %s", (_name, videoUrl, text) => {
    expect(() => createUserLesson({ title: "t", text, level: "B1", targetWpm: 110, videoUrl })).toThrow();
  });

  it("accepts 200 cues", () => {
    const lesson = createUserLesson({ title: "t", text: cueTranscript(200), level: "B1", targetWpm: 110, videoUrl: "https://youtu.be/dQw4w9WgXcQ" });
    expect(lesson.sentences).toHaveLength(200);
    expect(isValidUserLesson(lesson)).toBe(true);
  });

  it("accepts a stored video lesson and rejects NaN and infinite starts", () => {
    expect(isValidUserLesson(videoLesson)).toBe(true);
    for (const start of [Number.NaN, Number.POSITIVE_INFINITY]) {
      const sentences = [{ ...videoLesson.sentences[0], cue: { start, end: null } }];
      expect(isValidUserLesson({ ...videoLesson, sentences })).toBe(false);
    }
  });
});

describe("user lesson store", () => {
  it("round-trips put, list and delete", async () => {
    const other = { ...userLesson, id: "user-00000000-0000-4000-8000-000000000002", title: "Other" };
    await putUserLesson(userLesson);
    await putUserLesson(other);

    expect(await listUserLessons()).toEqual([userLesson, other]);

    await deleteUserLesson(userLesson.id);

    expect(await listUserLessons()).toEqual([other]);
  });
});
