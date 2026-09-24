import { useState } from "react";

import { readPref, writePref } from "../lib/prefs";
import { USER_LEVELS } from "../lib/userLessons";

export const LEVEL_FILTERS = ["All", ...USER_LEVELS] as const;
export type LevelFilter = (typeof LEVEL_FILTERS)[number];
const LEVEL_FILTER_KEY = "road-to-english.levelFilter";

function readLevelFilter(): LevelFilter {
  const stored = readPref(LEVEL_FILTER_KEY);
  return LEVEL_FILTERS.find((filter) => filter === stored) ?? "All";
}

// The lessons shown under a level filter, in order; null while not loaded.
export function filterByLevel<T extends { level: string }>(lessons: T[] | null, filter: LevelFilter): T[] | null {
  return filter === "All" ? lessons : (lessons?.filter((lesson) => lesson.level === filter) ?? null);
}

// The library's stored level filter; an unknown stored value reads as All.
export function useLevelFilter() {
  const [levelFilter, setLevelFilter] = useState(readLevelFilter);

  const chooseLevelFilter = (filter: LevelFilter) => {
    writePref(LEVEL_FILTER_KEY, filter);
    setLevelFilter(filter);
  };

  return { levelFilter, chooseLevelFilter };
}
