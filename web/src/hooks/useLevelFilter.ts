import { useState } from "react";

import { USER_LEVELS } from "../lib/userLessons";

export const LEVEL_FILTERS = ["All", ...USER_LEVELS] as const;
export type LevelFilter = (typeof LEVEL_FILTERS)[number];
const LEVEL_FILTER_KEY = "road-to-english.levelFilter";

function readLevelFilter(): LevelFilter {
  const stored = localStorage.getItem(LEVEL_FILTER_KEY);
  return LEVEL_FILTERS.find((filter) => filter === stored) ?? "All";
}

// The library's stored level filter; an unknown stored value reads as All.
export function useLevelFilter() {
  const [levelFilter, setLevelFilter] = useState(readLevelFilter);

  const chooseLevelFilter = (filter: LevelFilter) => {
    localStorage.setItem(LEVEL_FILTER_KEY, filter);
    setLevelFilter(filter);
  };

  return { levelFilter, chooseLevelFilter };
}
