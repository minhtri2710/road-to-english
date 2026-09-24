import { ApiError, request } from "./client";

export type Level = "A1" | "A2" | "B1" | "B2";

export interface Sentence {
  id: string;
  text: string;
  vi: string;
  notes?: string;
  cue?: Cue;
}

// Seconds into the lesson video; a null end plays to the end of the video.
export interface Cue {
  start: number;
  end: number | null;
}

export interface LessonSummary {
  id: string;
  title: string;
  level: Level;
  sentenceCount: number;
  targetWpm: number;
}

export interface Lesson {
  id: string;
  title: string;
  level: Level;
  targetWpm: number;
  sentences: Sentence[];
  videoId?: string;
}

export class NotFoundError extends ApiError {
  constructor() {
    super(404, null);
    this.name = "NotFoundError";
    this.message = "Lesson not found";
  }
}

async function requestLesson<T>(path: string): Promise<T> {
  try {
    return await request<T>(path);
  } catch (error) {
    throw error instanceof ApiError && error.status === 404 ? new NotFoundError() : error;
  }
}

export function fetchLessons(): Promise<LessonSummary[]> {
  return requestLesson<LessonSummary[]>("/lessons");
}

export function fetchLesson(id: string): Promise<Lesson> {
  return requestLesson<Lesson>(`/lessons/${encodeURIComponent(id)}`);
}
