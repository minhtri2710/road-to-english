import { useEffect, useState } from "react";

import {
  fetchLesson,
  fetchLessons,
  type Lesson,
  type LessonSummary,
} from "../api/lessons";

export interface AsyncData<T> {
  data: T | null;
  loading: boolean;
  error: Error | null;
}

export function useLessons(): AsyncData<LessonSummary[]> & { retry: () => void } {
  const [data, setData] = useState<LessonSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;

    setLoading(true);
    setError(null);

    fetchLessons()
      .then((lessons) => {
        if (active) {
          setData(lessons);
        }
      })
      .catch((requestError: unknown) => {
        if (active) {
          setError(
            requestError instanceof Error
              ? requestError
              : new Error("Unable to load lessons"),
          );
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [attempt]);

  return { data, loading, error, retry: () => setAttempt((count) => count + 1) };
}

export function useLesson(id: string | null): AsyncData<Lesson> {
  const [data, setData] = useState<Lesson | null>(null);
  const [loading, setLoading] = useState(id !== null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let active = true;

    if (id === null) {
      setData(null);
      setLoading(false);
      setError(null);
      return () => {
        active = false;
      };
    }

    setData(null);
    setLoading(true);
    setError(null);

    fetchLesson(id)
      .then((lesson) => {
        if (active) {
          setData(lesson);
        }
      })
      .catch((requestError: unknown) => {
        if (active) {
          setError(
            requestError instanceof Error
              ? requestError
              : new Error("Unable to load lesson"),
          );
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [id]);

  return { data, loading, error };
}
