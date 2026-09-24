import { useEffect, useState } from "react";

import { readPref, writePref } from "../lib/prefs";
import { parseRoute, routeHash, type Route } from "../lib/route";

export type LessonRoute = Extract<Route, { id: string }>;
const LAST_LESSON_KEY = "road-to-english.lastLesson";

function readLastLesson(): LessonRoute | null {
  const route = parseRoute(readPref(LAST_LESSON_KEY) ?? "");
  return route && "id" in route ? route : null;
}

// The route of the last lesson the learner opened, stored whenever an open lesson is shown.
export function useLastLesson(open: LessonRoute | null) {
  const [lastLesson, setLastLesson] = useState(readLastLesson);
  const openHash = open && routeHash(open);

  useEffect(() => {
    if (open) {
      writePref(LAST_LESSON_KEY, routeHash(open));
      setLastLesson(open);
    }
  }, [openHash]);

  return lastLesson;
}
