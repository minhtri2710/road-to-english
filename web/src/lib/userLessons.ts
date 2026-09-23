import type { Lesson, Level } from "../api/lessons";
import { openAppDatabase } from "./db";
import { splitWords } from "./dictation";
import { cardWord, isCardWord, isText } from "./vocab";
import { isYouTubeId, parseTranscript, parseYouTubeId } from "./youtube";

export const USER_LEVELS = ["A1", "A2", "B1", "B2"] as const satisfies readonly Level[];
export const USER_WPMS = ["90", "110", "130", "150"] as const;
export const MAX_TEXT_LENGTH = 20000;
export const MAX_SENTENCES = 200;
export const MAX_TITLE_LENGTH = 100;

// Best-effort: Intl.Segmenter splits after abbreviations such as "Mr." ("Mr. Smith" -> "Mr.", "Smith ...").
// A blank line is a hard break; other whitespace collapses before segmenting because ICU breaks at every
// newline, which would split hard-wrapped text.
export function segmentText(text: string): string[] {
  const segmenter = new Intl.Segmenter("en", { granularity: "sentence" });
  return text
    .split(/\n\s*\n/)
    .flatMap((paragraph) =>
      Array.from(segmenter.segment(paragraph.replace(/\s+/g, " ")), ({ segment }) => segment.trim()),
    )
    .filter((segment) => splitWords(segment).some((part) => isCardWord(cardWord(part))));
}

export function isValidTitle(value: unknown): value is string {
  return isText(value) && value === value.trim() && value.length >= 1 && value.length <= MAX_TITLE_LENGTH;
}

export function createUserLesson(input: {
  title: string;
  text: string;
  level: Level;
  targetWpm: number;
  videoUrl?: string;
}): Lesson {
  if (!isText(input.title) || !isText(input.text)) {
    throw new Error("Title and text must not contain NUL characters.");
  }
  const title = input.title.trim();
  if (!isValidTitle(title)) {
    throw new Error(`Title must be 1-${MAX_TITLE_LENGTH} characters.`);
  }
  if (input.text.length > MAX_TEXT_LENGTH) {
    throw new Error(`Text must be at most ${MAX_TEXT_LENGTH} characters.`);
  }
  const videoId = input.videoUrl ? parseYouTubeId(input.videoUrl) : null;
  if (input.videoUrl && !videoId) {
    throw new Error("Enter a YouTube video URL.");
  }
  const sentences = videoId ? parseTranscript(input.text) : segmentText(input.text).map((text) => ({ text }));
  if (sentences.length < 1 || sentences.length > MAX_SENTENCES) {
    throw new Error(`Text must contain 1-${MAX_SENTENCES} sentences.`);
  }
  return {
    id: `user-${crypto.randomUUID()}`,
    title,
    level: input.level,
    targetWpm: input.targetWpm,
    sentences: sentences.map((sentence, index) => ({ id: `s${index + 1}`, vi: "", ...sentence })),
    ...(videoId && { videoId }),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: string[]): boolean {
  return Object.keys(value).sort().join() === [...keys].sort().join();
}

// Cue starts are finite, >= 0 and strictly increasing; each end is the next start, and the last end is null.
function isValidCue(cue: unknown, nextSentence: unknown): boolean {
  if (!isRecord(cue) || !hasExactKeys(cue, ["start", "end"])) {
    return false;
  }
  const { start, end } = cue;
  if (typeof start !== "number" || !Number.isFinite(start) || start < 0) {
    return false;
  }
  if (nextSentence === undefined) {
    return end === null;
  }
  const nextStart = isRecord(nextSentence) && isRecord(nextSentence.cue) ? nextSentence.cue.start : undefined;
  return typeof end === "number" && end === nextStart && end > start;
}

export function isValidUserLesson(value: unknown): value is Lesson {
  const video = isRecord(value) && "videoId" in value;
  return (
    isRecord(value) &&
    hasExactKeys(value, ["id", "title", "level", "targetWpm", "sentences", ...(video ? ["videoId"] : [])]) &&
    (!video || isYouTubeId(value.videoId)) &&
    typeof value.id === "string" &&
    /^user-[0-9a-f-]{36}$/.test(value.id) &&
    isValidTitle(value.title) &&
    USER_LEVELS.some((level) => level === value.level) &&
    USER_WPMS.some((wpm) => Number(wpm) === value.targetWpm) &&
    Array.isArray(value.sentences) &&
    value.sentences.length >= 1 &&
    value.sentences.length <= MAX_SENTENCES &&
    value.sentences.every(
      (sentence, index, sentences) =>
        isRecord(sentence) &&
        hasExactKeys(sentence, ["id", "text", "vi", ...(video ? ["cue"] : [])]) &&
        (!video || isValidCue(sentence.cue, sentences[index + 1])) &&
        sentence.id === `s${index + 1}` &&
        isText(sentence.text) &&
        sentence.text.length > 0 &&
        sentence.vi === "",
    )
  );
}

export async function listUserLessons(): Promise<Lesson[]> {
  const db = await openAppDatabase();
  try {
    return await db.getAll("userLessons");
  } finally {
    db.close();
  }
}

export async function getUserLesson(id: string): Promise<Lesson | undefined> {
  const db = await openAppDatabase();
  try {
    return await db.get("userLessons", id);
  } finally {
    db.close();
  }
}

export async function putUserLesson(lesson: Lesson): Promise<void> {
  const db = await openAppDatabase();
  try {
    await db.put("userLessons", lesson);
  } finally {
    db.close();
  }
}

export async function deleteUserLesson(id: string): Promise<void> {
  const db = await openAppDatabase();
  try {
    await db.delete("userLessons", id);
  } finally {
    db.close();
  }
}
