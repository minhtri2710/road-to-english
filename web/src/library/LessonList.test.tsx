import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as progressStore from "../lib/progressStore";
import { createCard } from "../lib/vocab";
import * as vocabStore from "../lib/vocabStore";
import { putCard } from "../lib/vocabStore";
import {
  buttonsNamed,
  click,
  fetchMock,
  h1Texts,
  hasText,
  renderApp,
  resetApp,
  responseFor,
  waitForCondition,
} from "../test/app";

describe("LessonList", () => {
  afterEach(resetApp);

  const todayStrip = (container: HTMLElement) =>
    Array.from(container.querySelectorAll("h2")).find((heading) => heading.textContent === "Today")?.parentElement ?? null;

  it("Retry re-fetches the library after a failure", async () => {
    let fail = true;
    let release: () => void = () => undefined;
    const { container } = await renderApp({ route: async (path) => {
      if (path === "/lessons" && fail) {
        return new Response("boom", { status: 500 });
      }
      if (path === "/lessons") {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
      return responseFor(path);
    } });
    await waitForCondition(hasText(container, "Unable to load lessons"));
    expect(container.textContent).toContain("Your own lessons below still work offline.");

    fail = false;
    await click(container, "Retry");
    expect(container.textContent).toContain("Loading lessons...");
    await act(async () => {
      release();
    });
    await waitForCondition(hasText(container, "Greetings & Basics"));
    expect(container.textContent).not.toContain("Unable to load lessons");
  });

  it("moves focus from Retry to the library h1 before Retry unmounts into the loading line", async () => {
    let fail = true;
    const { container } = await renderApp({ route: (path) =>
      path === "/lessons" && fail ? new Response("boom", { status: 500 }) : responseFor(path),
    });
    await waitForCondition(hasText(container, "Unable to load lessons"));
    fail = false;
    buttonsNamed(container, "Retry")[0]!.focus();
    await click(container, "Retry");
    expect(document.activeElement).toBe(container.querySelector("main h1"));
    await waitForCondition(hasText(container, "Greetings & Basics"));
    expect(document.activeElement).toBe(container.querySelector("main h1"));
  });

  it("shows cards due, today's goal and Review as the next action when cards are due", async () => {
    for (const index of [0, 1]) {
      await putCard(
        createCard({ front: `f${index}`, back: "b", source: { lessonId: "l", sentenceId: `s${index}`, word: "" } }, new Date()),
      );
    }
    const view = await renderApp();
    const { container } = view;
    await waitForCondition(() => todayStrip(container)?.textContent?.includes("2 cards due") ?? false);
    const strip = todayStrip(container)!;
    expect(strip.textContent).toContain("2 cards due · Goal 0/10");
    expect(buttonsNamed(strip, "Start lesson")).toHaveLength(0);
    expect(container.querySelector('[role="group"][aria-label^="Daily goal"]')?.getAttribute("aria-label")).toBe(
      "Daily goal: practice actions per day",
    );

    await click(strip, "Review 2 cards");
    expect(h1Texts(container)).toEqual(["Review deck"]);
    expect(document.activeElement).toBe(container.querySelector("h1"));
  });

  it("offers the first lesson not yet completed when no cards are due", async () => {
    await progressStore.markLessonComplete("greetings-basics");
    const view = await renderApp();
    const { container } = view;
    await waitForCondition(() => buttonsNamed(container, "Start lesson").length === 1);
    const strip = todayStrip(container)!;
    expect(strip.textContent).toContain("0 cards due · Goal 0/10");
    expect(strip.textContent).toContain("Next: Daily Routine");

    await click(strip, "Start lesson");
    await waitForCondition(() => container.querySelector("main h1") !== null && h1Texts(container)[0] !== "Lesson library");
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/lessons/daily-routine"))).toBe(true);
  });

  it("shows no due count in the Today strip while the deck is loading", async () => {
    vi.spyOn(vocabStore, "getAllCards").mockReturnValue(new Promise(() => undefined));
    const view = await renderApp();
    await waitForCondition(() => buttonsNamed(view.container, "Start lesson").length === 1);
    const strip = todayStrip(view.container)!;
    expect(strip.textContent).toContain("Goal 0/10");
    expect(strip.textContent).not.toContain("due");
  });
});
