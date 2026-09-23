import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLesson, useLessons } from "./lessons";
import { greetingsLesson, lessonSummaries } from "../test/fixtures";

const fetchMock = vi.fn<typeof fetch>();

function HookProbe() {
  const lessons = useLessons();
  const lesson = useLesson("greetings-basics");

  if (lessons.loading || lesson.loading) {
    return createElement("p", null, "Loading");
  }

  return createElement(
    "output",
    null,
    lessons.data?.[0].title,
    " ",
    lesson.data?.sentences[0].text,
  );
}

describe("lesson hooks", () => {
  beforeEach(() => {
    fetchMock.mockImplementation(async (input) => {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url;
      const path = new URL(url, "http://localhost").pathname;

      if (path === "/lessons") {
        return new Response(JSON.stringify(lessonSummaries), { status: 200 });
      }

      return new Response(JSON.stringify(greetingsLesson), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fetchMock.mockReset();
  });

  it("exposes parsed list and detail data", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(StrictMode, null, createElement(HookProbe)),
      );
    });

    expect(container.textContent).toContain("Greetings & Basics");
    expect(container.textContent).toContain("Good morning, how are you today?");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("starts useLesson loading for an id and idle for null", async () => {
    const first: Record<string, boolean> = {};
    function FirstPaint({ id }: { id: string | null }) {
      const { loading } = useLesson(id);
      first[String(id)] ??= loading;
      return null;
    }
    const container = document.createElement("div");
    const root = createRoot(container);

    await act(async () => {
      root.render(
        createElement(
          StrictMode,
          null,
          createElement(FirstPaint, { id: "greetings-basics" }),
          createElement(FirstPaint, { id: null }),
        ),
      );
    });

    expect(first).toEqual({ "greetings-basics": true, null: false });
    await act(async () => {
      root.unmount();
    });
  });
});
