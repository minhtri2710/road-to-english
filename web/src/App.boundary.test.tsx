import { afterEach, expect, it, vi } from "vitest";

import { renderApp, resetApp } from "./test/app";

// The library view crashes as it renders, so the App shows the ErrorBoundary fallback.
vi.mock("./library/LessonList", () => ({
  LessonList: () => {
    throw new Error("boom");
  },
}));

afterEach(resetApp);

it("renders the crash fallback inside the App's one Theme", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { container } = await renderApp();

  const heading = container.querySelector("h1");
  expect(heading?.textContent).toBe("Something went wrong");
  expect(heading?.closest("[data-astryx-theme]")).not.toBeNull();
  expect(container.querySelectorAll("[data-astryx-theme]")).toHaveLength(1);
});
