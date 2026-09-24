import { useEffect, useState } from "react";

import {
  fetchLesson,
  fetchLessons,
  type Lesson,
  type LessonSummary,
} from "../api/lessons";
import { deleteUserLesson, listUserLessons, putUserLesson } from "../lib/userLessons";

interface AsyncData<T> {
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

export function useLesson(id: string): AsyncData<Lesson> {
  const [data, setData] = useState<Lesson | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let active = true;

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

// This device's own lessons: null while loading, or the load error. Reload never throws.
export function useUserLessons() {
  const [lessons, setLessons] = useState<Lesson[] | Error | null>(null);

  const load = () =>
    listUserLessons().catch((loadError: unknown) =>
      loadError instanceof Error ? loadError : new Error("Unable to load your lessons"),
    );

  const reload = async () => {
    setLessons(await load());
  };

  useEffect(() => {
    let active = true;
    void load().then((loaded) => {
      if (active) {
        setLessons(loaded);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const create = async (lesson: Lesson) => {
    await putUserLesson(lesson);
    await reload();
  };

  // Throws if the delete fails, before reloading.
  const remove = async (id: string) => {
    await deleteUserLesson(id);
    await reload();
  };

  return { lessons, reload, create, remove };
}
