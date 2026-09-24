import type { Lesson, LessonSummary } from "../api/lessons";
import { createCard, type VocabCard } from "../lib/vocab";

// A New card on lesson-1: id "lesson-1:<sentenceId>", front defaulting to the sentence id.
export function card(
  sentenceId = "sentence-1",
  now = new Date("2026-01-01T00:00:00Z"),
  { front = sentenceId, back = "hola" }: { front?: string; back?: string } = {},
): VocabCard {
  return createCard({ front, back, source: { lessonId: "lesson-1", sentenceId, word: "" } }, now);
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export const lessonSummaries = [
  {
    id: "greetings-basics",
    title: "Greetings & Basics",
    level: "A2",
    sentenceCount: 3,
    targetWpm: 90,
  },
  {
    id: "daily-routine",
    title: "Daily Routine",
    level: "B1",
    sentenceCount: 3,
    targetWpm: 110,
  },
] satisfies LessonSummary[];

export const userLesson = {
  id: "user-00000000-0000-4000-8000-000000000001",
  title: "My text",
  level: "B1",
  targetWpm: 110,
  sentences: [
    { id: "s1", text: "I like tea.", vi: "" },
    { id: "s2", text: "You like coffee.", vi: "" },
  ],
} satisfies Lesson;

export const videoLesson = {
  id: "user-00000000-0000-4000-8000-000000000003",
  title: "Tea video",
  level: "B1",
  targetWpm: 110,
  videoId: "dQw4w9WgXcQ",
  sentences: [
    { id: "s1", text: "I like tea.", vi: "", cue: { start: 0, end: 2.5 } },
    { id: "s2", text: "You like coffee.", vi: "", cue: { start: 2.5, end: 65 } },
    { id: "s3", text: "We drink it daily.", vi: "", cue: { start: 65, end: null } },
  ],
} satisfies Lesson;

export const greetingsLesson = {
  id: "greetings-basics",
  title: "Greetings & Basics",
  level: "A2",
  targetWpm: 90,
  sentences: [
    { id: "greetings-basics-1", text: "Good morning, how are you today?", vi: "Chào buổi sáng, hôm nay bạn thế nào?" },
    { id: "greetings-basics-2", text: "It is nice to meet you.", vi: "Rất vui được gặp bạn." },
    {
      id: "greetings-basics-3",
      text: "See you tomorrow.",
      vi: "Hẹn gặp lại ngày mai.",
      notes: "casual sign-off",
    },
  ],
} satisfies Lesson;
