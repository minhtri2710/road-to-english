export type Level = "A2" | "B1" | "B2";

export interface Sentence {
  id: string;
  text: string;
  vi: string;
  notes?: string;
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
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
  }
}

export class NotFoundError extends ApiError {
  constructor() {
    super(404);
    this.name = "NotFoundError";
    this.message = "Lesson not found";
  }
}

const apiUrl = import.meta.env.VITE_API_URL ?? "";

export function getUrl(path: string): string {
  return `${apiUrl.replace(/\/$/, "")}${path}`;
}

async function request<T>(path: string): Promise<T> {
  const response = await fetch(getUrl(path));

  if (!response.ok) {
    if (response.status === 404) {
      throw new NotFoundError();
    }

    throw new ApiError(response.status);
  }

  return (await response.json()) as T;
}

export function fetchLessons(): Promise<LessonSummary[]> {
  return request<LessonSummary[]>("/lessons");
}

export function fetchLesson(id: string): Promise<Lesson> {
  return request<Lesson>(`/lessons/${encodeURIComponent(id)}`);
}
