import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchLesson, fetchLessons, NotFoundError } from "./lessons";
import { greetingsLesson, lessonSummaries } from "../test/fixtures";

const fetchMock = vi.fn<typeof fetch>();

describe("lessons API client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fetchMock.mockReset();
  });

  it("parses the pinned lesson library fixture", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(lessonSummaries), { status: 200 }),
    );

    await expect(fetchLessons()).resolves.toEqual(lessonSummaries);
    expect(fetchMock).toHaveBeenCalledWith("/lessons");
  });

  it("parses the pinned lesson detail fixture", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify(greetingsLesson), { status: 200 }),
    );

    await expect(fetchLesson("greetings-basics")).resolves.toEqual(
      greetingsLesson,
    );
    expect(fetchMock).toHaveBeenCalledWith("/lessons/greetings-basics");
  });

  it("turns a 404 into a distinguishable not-found error", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "not found" }), { status: 404 }),
    );

    await expect(fetchLesson("does-not-exist")).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it("throws for other non-2xx responses", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));

    await expect(fetchLessons()).rejects.toThrow("status 500");
  });
});
