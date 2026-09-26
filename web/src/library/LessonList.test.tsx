import { afterEach, describe, expect, it, vi } from "vitest";

import * as progressStore from "../lib/progressStore";
import { todayKey } from "../lib/progress";
import { putUserLesson } from "../lib/userLessons";
import { createCard } from "../lib/vocab";
import * as vocabStore from "../lib/vocabStore";
import { putCard } from "../lib/vocabStore";
import {
  blockStorage,
  buttonsNamed,
  click,
  close,
  fetchMock,
  h1Texts,
  harnessAct,
  hasText,
  renderApp,
  resetApp,
  responseFor,
  waitForCondition,
} from "../test/app";
import { userLesson } from "../test/fixtures";

describe("LessonList", () => {
  afterEach(async () => {
    vi.useRealTimers();
    await resetApp();
  });

  const todayCard = (container: HTMLElement) =>
    Array.from(container.querySelectorAll("h2")).find((heading) => heading.textContent === "Today")?.parentElement?.parentElement ?? null;

  it("names each lesson row by its title and describes it by level, sentence count, WPM and completion", async () => {
    await progressStore.markLessonComplete("greetings-basics");
    const { container } = await renderApp();
    await waitForCondition(hasText(container, "Completed"));
    const described = (title: string) => {
      const row = Array.from(container.querySelectorAll("main li button")).find((button) => button.getAttribute("aria-label") === title);
      if (!row) throw new Error(`${title} row not found`);
      return (row.getAttribute("aria-describedby") ?? "")
        .split(" ")
        .map((id) => document.getElementById(id)?.textContent)
        .join(" ");
    };
    expect(described("Greetings & Basics")).toBe("A2 · 3 sentences 90 WPM Completed");
    expect(described("Daily Routine")).toBe("B1 · 3 sentences 110 WPM");
  });

  it("describes Start lesson and Continue by the lesson they open", async () => {
    const { container } = await renderApp();
    await waitForCondition(() => buttonsNamed(container, "Start lesson").length === 1);
    const described = (name: string) =>
      document.getElementById(buttonsNamed(container, name)[0]?.getAttribute("aria-describedby") ?? "")?.textContent;
    expect(described("Start lesson")).toBe("Next: Greetings & Basics");

    await click(container, "Start lesson");
    await waitForCondition(() => h1Texts(container)[0] === "Greetings & Basics");
    await click(container, "Back to lessons");
    await waitForCondition(() => buttonsNamed(container, "Continue").length === 1);
    expect(described("Continue")).toBe("Continue: Greetings & Basics");
  });

  it("keeps management sections out of the library and names the level choices apart", async () => {
    const { container } = await renderApp();
    await waitForCondition(hasText(container, "Greetings & Basics"));
    expect(Array.from(container.querySelectorAll("h2")).map((heading) => heading.textContent)).toEqual([
      "Today",
      "Library lessons",
      "Your lessons",
    ]);
    expect(container.textContent).not.toContain("Import text");
    expect(container.textContent).not.toContain("Your data");
    expect(container.querySelector('[role="radiogroup"][aria-label="Library level"]')).not.toBeNull();
    expect(container.querySelector('form [role="group"][aria-label="Lesson level"]')).toBeNull();
    expect(container.querySelectorAll('[aria-label="Level"]')).toHaveLength(0);
  });

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
    await harnessAct(async () => {
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
    await waitForCondition(() => todayCard(container)?.textContent?.includes("2 cards due") ?? false);
    const card = todayCard(container)!;
    expect(card.textContent).toContain("2 cards due");
    expect(buttonsNamed(card, "Start lesson")).toHaveLength(0);

    await click(card, "Review 2 cards");
    expect(h1Texts(container)).toEqual(["Review deck"]);
    expect(document.activeElement).toBe(container.querySelector("h1"));
  });

  it("offers the first lesson not yet completed when no cards are due", async () => {
    await progressStore.markLessonComplete("greetings-basics");
    const view = await renderApp();
    const { container } = view;
    await waitForCondition(() => buttonsNamed(container, "Start lesson").length === 1);
    const card = todayCard(container)!;
    expect(card.textContent).toContain("0 cards due · Next: Daily Routine");

    await click(card, "Start lesson");
    await waitForCondition(() => container.querySelector("main h1") !== null && h1Texts(container)[0] !== "Lesson library");
    expect(fetchMock.mock.calls.some(([input]) => String(input).endsWith("/lessons/daily-routine"))).toBe(true);
  });

  it("shows no due count in the Today card while the deck is loading", async () => {
    vi.spyOn(vocabStore, "getAllCards").mockReturnValue(new Promise(() => undefined));
    const view = await renderApp();
    await waitForCondition(() => buttonsNamed(view.container, "Start lesson").length === 1);
    const card = todayCard(view.container)!;
    expect(card.textContent).toContain("0 of 10 practice actions today");
    expect(card.textContent).not.toContain("due");
  });

  const progressBar = (card: HTMLElement) => card.querySelector<HTMLElement>('[role="progressbar"]')!;
  const dayMarks = (card: HTMLElement) => Array.from(card.querySelectorAll<HTMLElement>('[aria-label="This week"] li'));

  it("shows the daily goal, the goal picker, a fresh streak, the week, freezes and XP in the Today card", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 0, 8, 12));
    const { container } = await renderApp();
    await waitForCondition(() => buttonsNamed(container, "Start lesson").length === 1);
    const card = todayCard(container)!;

    const bar = progressBar(card);
    expect(card.textContent).toContain("0 of 10 practice actions today");
    expect(bar.getAttribute("aria-valuenow")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("10");
    expect(card.textContent).not.toContain("Daily goal met");
    const picker = card.querySelector<HTMLElement>('[role="group"][aria-label="Daily goal"]')!;
    expect(["5 Light", "10 Regular", "20 Intense"].map((name) => buttonsNamed(picker, name).length)).toEqual([1, 1, 1]);

    expect(card.textContent).toContain("Start a new streak today");
    expect(card.textContent).not.toMatch(/lost|broke|missed/i);
    const marks = dayMarks(card);
    expect(marks.map((mark) => mark.textContent)).toEqual(
      ["Fri", "Sat", "Sun", "Mon", "Tue", "Wed", "Thu"].map((label) => expect.stringContaining(label)),
    );
    expect(marks.every((mark) => mark.textContent?.includes("not practised"))).toBe(true);
    expect(marks.map((mark) => mark.getAttribute("aria-current"))).toEqual([null, null, null, null, null, null, "date"]);

    expect(card.textContent).toContain("Freezes 0 of 2");
    expect(card.textContent).toContain("0 XP");
    // The order the card reads in: action row, goal, picker, streak, XP.
    const text = card.textContent!;
    const order = ["Today", "practice actions today", "5 Light", "Start a new streak today", "Freezes", "0 XP"].map((part) =>
      text.indexOf(part),
    );
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("marks practised days, counts the streak, explains freezes, and says when the goal is met", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 0, 8, 12));
    for (let day = 1; day <= 7; day += 1) {
      await progressStore.recordPractice(todayKey(new Date(2026, 0, day)), { newCard: false });
    }
    localStorage.setItem("road-to-english.dailyGoal", "5");
    for (let index = 0; index < 5; index += 1) {
      await progressStore.recordPractice(todayKey(new Date(2026, 0, 8)), { newCard: false });
    }
    const { container } = await renderApp();
    await waitForCondition(() => todayCard(container)?.textContent?.includes("8-day streak") ?? false);
    const card = todayCard(container)!;

    expect(card.textContent).toContain("5 of 5 practice actions today");
    expect(card.textContent).toContain("Daily goal met");
    expect(progressBar(card).getAttribute("aria-valuenow")).toBe("5");
    expect(dayMarks(card).every((mark) => mark.textContent?.includes("practised") && !mark.textContent.includes("not practised"))).toBe(
      true,
    );
    expect(card.textContent).toContain("120 XP");

    const freezes = Array.from(card.querySelectorAll<HTMLElement>("[tabindex='0']")).find(
      (el) => el.textContent === "Freezes 1 of 2",
    )!;
    const tip = document.getElementById(freezes.getAttribute("aria-describedby")!.split(" ")[0]!);
    expect(tip?.textContent).toBe(
      "A freeze keeps your streak when you miss one day. You earn one for every 7 days in a row, up to 2.",
    );
  });

  const radio = (container: HTMLElement, name: string) =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('[role="radiogroup"][aria-label="Library level"] [role="radio"]')).find(
      (item) => item.textContent === name,
    );
  const choose = async (container: HTMLElement, name: string) => {
    const item = radio(container, name)!;
    item.focus();
    await harnessAct(async () => {
      item.click();
    });
  };

  describe("level filter", () => {
    it("filters only the library list, stores the level, and keeps focus on the control", async () => {
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
      // The Today card's goal bar comes first; the level's bar follows the Level control.
      const bar = container.querySelectorAll('[role="progressbar"]')[1]!;
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
      expect(todayCard(container)!.textContent).toContain("Next: Daily Routine");
      expect(container.textContent).not.toContain("Greetings & Basics");
    });
  });

  describe("Continue", () => {
    const openAndLeave = async (container: HTMLElement, title: string) => {
      await harnessAct(async () => {
        Array.from(container.querySelectorAll("li button")).find((row) => row.textContent?.startsWith(title))
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await waitForCondition(() => buttonsNamed(container, "Back to lessons").length === 1);
      await click(container, "Back to lessons");
      await waitForCondition(() => todayCard(container) !== null);
    };

    it("continues the last opened library lesson and remembers it across a reload", async () => {
      const first = await renderApp();
      await waitForCondition(hasText(first.container, "Daily Routine"));
      await openAndLeave(first.container, "Daily Routine");
      await waitForCondition(() => buttonsNamed(first.container, "Continue").length === 1);
      expect(todayCard(first.container)!.textContent).toContain("Continue: Daily Routine");
      expect(buttonsNamed(first.container, "Start lesson")).toHaveLength(0);
      expect(localStorage.getItem("road-to-english.lastLesson")).toBe("#/lesson/daily-routine");
      await first.unmount();

      const { container } = await renderApp();
      await waitForCondition(() => buttonsNamed(container, "Continue").length === 1);
      await click(todayCard(container)!, "Continue");
      await waitForCondition(() => window.location.hash === "#/lesson/daily-routine");
    });

    it("continues an own lesson, and never a deleted or completed one", async () => {
      await putUserLesson(userLesson);
      vi.stubGlobal("confirm", () => true);
      const { container } = await renderApp();
      await waitForCondition(hasText(container, userLesson.title));
      await openAndLeave(container, userLesson.title);
      await waitForCondition(() => buttonsNamed(container, "Continue").length === 1);
      expect(todayCard(container)!.textContent).toContain(`Continue: ${userLesson.title}`);

      await click(container, "Delete");
      await waitForCondition(hasText(container, "No lessons of your own yet"));
      expect(buttonsNamed(container, "Continue")).toHaveLength(0);
      expect(todayCard(container)!.textContent).toContain("Next: Greetings & Basics");
    });

    it("shows Next instead of Continue for a completed lesson, and Review while cards are due", async () => {
      await progressStore.markLessonComplete("daily-routine");
      localStorage.setItem("road-to-english.lastLesson", "#/lesson/daily-routine");
      const { container } = await renderApp();
      await waitForCondition(() => buttonsNamed(container, "Start lesson").length === 1);
      expect(buttonsNamed(container, "Continue")).toHaveLength(0);
      expect(todayCard(container)!.textContent).toContain("Next: Greetings & Basics");
    });

    it("keeps Review ahead of Continue while cards are due", async () => {
      await putCard(createCard({ front: "f", back: "b", source: { lessonId: "l", sentenceId: "s", word: "" } }, new Date()));
      localStorage.setItem("road-to-english.lastLesson", "#/lesson/daily-routine");
      const { container } = await renderApp();
      await waitForCondition(() => buttonsNamed(container, "Review 1 card").length === 1);
      expect(buttonsNamed(container, "Continue")).toHaveLength(0);
    });
  });

  describe("blocked storage", () => {
    it("renders the library with defaults and keeps choices for the session", async () => {
      blockStorage();
      const { container } = await renderApp();
      await waitForCondition(hasText(container, "Daily Routine"));
      expect(container.textContent).toContain("Greetings & Basics");
      expect(radio(container, "All")?.getAttribute("aria-checked")).toBe("true");

      await click(container, "Skip");
      await waitForCondition(() => todayCard(container) !== null);
      expect(todayCard(container)!.textContent).toContain("0 of 10 practice actions today");
      await click(todayCard(container)!, "20 Intense");
      expect(todayCard(container)!.textContent).toContain("0 of 20 practice actions today");
      await choose(container, "B1");
      expect(container.textContent).not.toContain("Greetings & Basics");
      expect(radio(container, "B1")?.getAttribute("aria-checked")).toBe("true");

      await harnessAct(async () => {
        Array.from(container.querySelectorAll("li button")).find((row) => row.textContent?.startsWith("Daily Routine"))
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await waitForCondition(() => buttonsNamed(container, "Back to lessons").length === 1);
      await click(container, "Back to lessons");
      await waitForCondition(() => buttonsNamed(container, "Continue").length === 1);
      expect(todayCard(container)!.textContent).toContain("Continue: Daily Routine");
    });

    it("keeps a choice for the session when reads work but writes fail", async () => {
      localStorage.setItem("road-to-english.levelFilter", "A2");
      const stored = localStorage;
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: {
          getItem: (key: string) => stored.getItem(key),
          setItem: () => {
            throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
          },
        },
      });
      const view = await renderApp();
      const { container } = view;
      await waitForCondition(() => radio(container, "A2")?.getAttribute("aria-checked") === "true");
      await choose(container, "B1");
      expect(radio(container, "B1")?.getAttribute("aria-checked")).toBe("true");

      expect(stored.getItem("road-to-english.levelFilter")).toBe("A2");
      await close(view);
      const remounted = await renderApp();
      await waitForCondition(() => radio(remounted.container, "B1") !== undefined);
      expect(radio(remounted.container, "B1")?.getAttribute("aria-checked")).toBe("true");
    });

    for (const junk of ["not a route", "#/review", "#/lesson/%E0%A4", "#/lesson/no-such-lesson", "#/my/no-such-lesson"]) {
      it(`shows no Continue for the junk last lesson ${junk}`, async () => {
        localStorage.setItem("road-to-english.lastLesson", junk);
        const { container } = await renderApp();
        await waitForCondition(() => buttonsNamed(container, "Start lesson").length === 1);
        expect(buttonsNamed(container, "Continue")).toHaveLength(0);
        expect(todayCard(container)!.textContent).toContain("Next: Greetings & Basics");
      });
    }
  });

  describe("first-run welcome", () => {
    const WELCOMED = "road-to-english.welcomed";
    const heading = (container: HTMLElement, text: string) =>
      Array.from(container.querySelectorAll("h2")).find((candidate) => candidate.textContent === text);
    const welcome = (container: HTMLElement) => heading(container, "Welcome to Road to English")?.closest("section") ?? null;
    const welcomeRadio = (container: HTMLElement, name: string) =>
      Array.from(
        welcome(container)?.querySelectorAll<HTMLButtonElement>('[role="radiogroup"][aria-label="English level"] [role="radio"]') ?? [],
      ).find((item) => item.textContent === name);
    const question = (container: HTMLElement, text: string) =>
      Array.from(container.querySelectorAll("p")).find((candidate) => candidate.textContent === text);
    const firstRun = async () => {
      localStorage.removeItem(WELCOMED);
      const view = await renderApp();
      await waitForCondition(hasText(view.container, "Greetings & Basics"));
      return view;
    };

    it("shows on the first run in the Today card's place as a labelled region, and not once welcomed", async () => {
      const first = await firstRun();
      const region = welcome(first.container)!;
      expect(region.getAttribute("aria-labelledby")).toBe(heading(first.container, "Welcome to Road to English")!.id);
      expect(region.textContent).toContain("Step 1 of 2");
      expect(question(region, "What is your English level?")).toBeDefined();
      expect(heading(first.container, "Today")).toBeUndefined();
      expect(document.activeElement).toBe(document.body);
      await first.unmount();

      localStorage.setItem(WELCOMED, "yes");
      const unknown = await renderApp();
      await waitForCondition(hasText(unknown.container, "Greetings & Basics"));
      expect(welcome(unknown.container)).not.toBeNull();
      await unknown.unmount();

      localStorage.removeItem(WELCOMED);
      const welcomed = await renderApp();
      await click(welcomed.container, "Skip");
      await welcomed.unmount();
      const again = await renderApp();
      await waitForCondition(hasText(again.container, "Greetings & Basics"));
      expect(welcome(again.container)).toBeNull();
      expect(heading(again.container, "Today")).toBeDefined();
    });

    it("preselects the stored level and goal, and offers Not sure as All", async () => {
      localStorage.setItem("road-to-english.levelFilter", "A2");
      localStorage.setItem("road-to-english.dailyGoal", "20");
      const { container } = await firstRun();
      expect(["Not sure", "A1", "A2", "B1", "B2"].every((name) => welcomeRadio(container, name))).toBe(true);
      expect(welcomeRadio(container, "A2")?.getAttribute("aria-checked")).toBe("true");
      await click(container, "Next");
      const intense = buttonsNamed(welcome(container)!, "20 Intense")[0]!;
      expect(intense.getAttribute("aria-pressed")).toBe("true");
    });

    it("filters the list as soon as a level is chosen and keeps it across a remount", async () => {
      const first = await firstRun();
      await harnessAct(async () => {
        welcomeRadio(first.container, "B1")!.click();
      });
      expect(first.container.textContent).not.toContain("Greetings & Basics");
      expect(first.container.textContent).toContain("Daily Routine");
      expect(radio(first.container, "B1")?.getAttribute("aria-checked")).toBe("true");
      expect(localStorage.getItem("road-to-english.levelFilter")).toBe("B1");
      await harnessAct(async () => {
        welcomeRadio(first.container, "Not sure")!.click();
      });
      expect(localStorage.getItem("road-to-english.levelFilter")).toBe("All");
      await harnessAct(async () => {
        welcomeRadio(first.container, "B1")!.click();
      });
      await first.unmount();

      const second = await renderApp();
      await waitForCondition(hasText(second.container, "Daily Routine"));
      expect(second.container.textContent).not.toContain("Greetings & Basics");
      expect(welcomeRadio(second.container, "B1")?.getAttribute("aria-checked")).toBe("true");
    });

    it("Next moves to step 2 and focuses its question; the goal choice persists; Done shows the Today card", async () => {
      const first = await firstRun();
      await click(first.container, "Next");
      const region = welcome(first.container)!;
      expect(region.textContent).toContain("Step 2 of 2");
      expect(region.textContent).toContain(
        "You can change both later: the level filter below the Today card and the goal in the Today card.",
      );
      expect(document.activeElement).toBe(question(region, "How much practice a day?"));

      // Choosing keeps focus on the choice: the question takes focus only once, after Next.
      buttonsNamed(region, "20 Intense")[0]!.focus();
      const intense = await click(region, "20 Intense");
      expect(localStorage.getItem("road-to-english.dailyGoal")).toBe("20");
      expect(intense.getAttribute("aria-pressed")).toBe("true");
      expect(document.activeElement).toBe(intense);

      await click(region, "Done");
      expect(welcome(first.container)).toBeNull();
      expect(document.activeElement).toBe(heading(first.container, "Today"));
      expect(todayCard(first.container)!.textContent).toContain("0 of 20 practice actions today");
      expect(localStorage.getItem(WELCOMED)).toBe("done");
      await first.unmount();

      const second = await renderApp();
      await waitForCondition(hasText(second.container, "Greetings & Basics"));
      expect(welcome(second.container)).toBeNull();
      expect(todayCard(second.container)!.textContent).toContain("0 of 20 practice actions today");
    });

    for (const step of [1, 2]) {
      it(`Skip on step ${step} stores only the welcome, shows the Today card and focuses its heading`, async () => {
        const first = await firstRun();
        if (step === 2) {
          await click(first.container, "Next");
        }
        await click(welcome(first.container)!, "Skip");
        expect(welcome(first.container)).toBeNull();
        expect(document.activeElement).toBe(heading(first.container, "Today"));
        expect({ ...localStorage }).toEqual({ [WELCOMED]: "done" });
        await first.unmount();

        const second = await renderApp();
        await waitForCondition(hasText(second.container, "Greetings & Basics"));
        expect(welcome(second.container)).toBeNull();
        expect(heading(second.container, "Today")).toBeDefined();
      });
    }
  });
});
