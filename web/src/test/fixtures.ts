import type { Lesson, LessonSummary } from "../api/lessons";

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
