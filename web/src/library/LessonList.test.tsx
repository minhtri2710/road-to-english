import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as progressStore from "../lib/progressStore";
import { putUserLesson } from "../lib/userLessons";
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
import { userLesson } from "../test/fixtures";

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

  const radio = (container: HTMLElement, name: string) =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('[role="radiogroup"][aria-label="Level"] [role="radio"]')).find(
      (item) => item.textContent === name,
    );
  const choose = async (container: HTMLElement, name: string) => {
    const item = radio(container, name)!;
    item.focus();
    await act(async () => {
      item.click();
    });
  };

  describe("level filter", () => {
    it("filters only the library list, remembers the level, and keeps focus on the control", async () => {
      await putUserLesson({ ...userLesson, level: "A1" });
      const { container } = await renderApp();
      await waitForCondition(hasText(container, "Daily Routine"));
      expect(radio(container, "All")?.getAttribute("aria-checked")).toBe("true");
      expect(["All", "A1", "A2", "B1", "B2"].every((name) => radio(container, name))).toBe(true);

      await choose(container, "B1");
      expect(container.textContent).not.toContain("Greetings & Basics");
      expect(container.textContent).toContain("Daily Routine");
      expect(container.textContent).toContain(userLesson.title);
      expect(localStorage.getItem("road-to-english.levelFilter")).toBe("B1");
      expect(document.activeElement).toBe(radio(container, "B1"));
    });

    it("reads a stored level and treats an unknown one as All", async () => {
      localStorage.setItem("road-to-english.levelFilter", "A2");
      const first = await renderApp();
      await waitForCondition(hasText(first.container, "Greetings & Basics"));
      expect(first.container.textContent).not.toContain("Daily Routine");
      await first.unmount();

      localStorage.setItem("road-to-english.levelFilter", "C1");
      const second = await renderApp();
      await waitForCondition(hasText(second.container, "Daily Routine"));
      expect(second.container.textContent).toContain("Greetings & Basics");
      expect(radio(second.container, "All")?.getAttribute("aria-checked")).toBe("true");
    });

    it("shows library progress for All and for a level as text and as the bar's value", async () => {
      await progressStore.markLessonComplete("greetings-basics");
      await putUserLesson(userLesson);
      const { container } = await renderApp();
      await waitForCondition(hasText(container, "1 of 2 completed"));
      const bar = container.querySelector('[role="progressbar"]')!;
      expect(bar.getAttribute("aria-valuenow")).toBe("1");
      expect(bar.getAttribute("aria-valuemax")).toBe("2");
      expect(bar.getAttribute("aria-labelledby")).not.toBeNull();

      await choose(container, "A2");
      expect(container.textContent).toContain("A2: 1 of 1 completed");
      expect(bar.getAttribute("aria-valuenow")).toBe("1");
      await choose(container, "B1");
      expect(container.textContent).toContain("B1: 0 of 1 completed");
    });

    it("offers the first unfinished lesson in the selected level as Next", async () => {
      localStorage.setItem("road-to-english.levelFilter", "B1");
      const { container } = await renderApp();
      await waitForCondition(() => buttonsNamed(container, "Start lesson").length === 1);
      expect(todayStrip(container)!.textContent).toContain("Next: Daily Routine");
      expect(container.textContent).not.toContain("Greetings & Basics");
    });
  });

  describe("Continue", () => {
    const openAndLeave = async (container: HTMLElement, title: string) => {
      await act(async () => {
        Array.from(container.querySelectorAll("li button")).find((row) => row.textContent?.startsWith(title))
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await waitForCondition(() => buttonsNamed(container, "Back to lessons").length === 1);
      await click(container, "Back to lessons");
      await waitForCondition(() => todayStrip(container) !== null);
    };

    it("continues the last opened library lesson and remembers it across a reload", async () => {
      const first = await renderApp();
      await waitForCondition(hasText(first.container, "Daily Routine"));
      await openAndLeave(first.container, "Daily Routine");
      await waitForCondition(() => buttonsNamed(first.container, "Continue").length === 1);
      expect(todayStrip(first.container)!.textContent).toContain("Continue: Daily Routine");
      expect(buttonsNamed(first.container, "Start lesson")).toHaveLength(0);
      expect(localStorage.getItem("road-to-english.lastLesson")).toBe("#/lesson/daily-routine");
      await first.unmount();

      const { container } = await renderApp();
      await waitForCondition(() => buttonsNamed(container, "Continue").length === 1);
      await click(todayStrip(container)!, "Continue");
      await waitForCondition(() => window.location.hash === "#/lesson/daily-routine");
    });

    it("continues an own lesson, and never a deleted or completed one", async () => {
      await putUserLesson(userLesson);
      vi.stubGlobal("confirm", () => true);
      const { container } = await renderApp();
      await waitForCondition(hasText(container, userLesson.title));
      await openAndLeave(container, userLesson.title);
      await waitForCondition(() => buttonsNamed(container, "Continue").length === 1);
      expect(todayStrip(container)!.textContent).toContain(`Continue: ${userLesson.title}`);

      await click(container, "Delete");
      await waitForCondition(hasText(container, "No lessons of your own yet"));
      expect(buttonsNamed(container, "Continue")).toHaveLength(0);
      expect(todayStrip(container)!.textContent).toContain("Next: Greetings & Basics");
    });

    it("shows Next instead of Continue for a completed lesson, and Review while cards are due", async () => {
      await progressStore.markLessonComplete("daily-routine");
      localStorage.setItem("road-to-english.lastLesson", "#/lesson/daily-routine");
      const { container } = await renderApp();
      await waitForCondition(() => buttonsNamed(container, "Start lesson").length === 1);
      expect(buttonsNamed(container, "Continue")).toHaveLength(0);
      expect(todayStrip(container)!.textContent).toContain("Next: Greetings & Basics");
    });

    it("keeps Review ahead of Continue while cards are due", async () => {
      await putCard(createCard({ front: "f", back: "b", source: { lessonId: "l", sentenceId: "s", word: "" } }, new Date()));
      localStorage.setItem("road-to-english.lastLesson", "#/lesson/daily-routine");
      const { container } = await renderApp();
      await waitForCondition(() => buttonsNamed(container, "Review 1 card").length === 1);
      expect(buttonsNamed(container, "Continue")).toHaveLength(0);
    });
  });
});
