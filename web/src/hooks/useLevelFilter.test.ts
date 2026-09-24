import { describe, expect, it } from "vitest";

import { filterByLevel } from "./useLevelFilter";

describe("filterByLevel", () => {
  const lessons = [
    { id: "a", level: "A1" },
    { id: "b", level: "B1" },
    { id: "c", level: "A1" },
  ];

  it("keeps every lesson under All and the lessons of one level otherwise, in order", () => {
    expect(filterByLevel(lessons, "All")).toBe(lessons);
    expect(filterByLevel(lessons, "A1")?.map((lesson) => lesson.id)).toEqual(["a", "c"]);
    expect(filterByLevel(lessons, "B2")).toEqual([]);
  });

  it("passes on lessons that are not loaded", () => {
    expect(filterByLevel(null, "A1")).toBeNull();
    expect(filterByLevel(null, "All")).toBeNull();
  });
});
