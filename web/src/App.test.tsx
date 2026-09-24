import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { exportData } from "./lib/backup";
import { todayKey } from "./lib/progress";
import { recordPractice, getPracticeDays } from "./lib/progressStore";
import { createCard, deleteCard, Rating, reviewCard, State } from "./lib/vocab";
import { getAllCards, putCard } from "./lib/vocabStore";
import { blankFor } from "./lib/dictation";
import * as backupStore from "./lib/backupStore";
import * as progressStore from "./lib/progressStore";
import * as userLessonsStore from "./lib/userLessons";
import * as vocabStore from "./lib/vocabStore";
import { listUserLessons, putUserLesson } from "./lib/userLessons";
import {
  buttonsNamed,
  callsTo,
  click,
  close,
  fetchMock,
  h1Texts,
  hasText,
  openLesson,
  pathOf,
  renderApp,
  resetApp,
  responseFor,
  restoreProperty,
  routeFetch,
  setInputValue,
  userResponse,
  waitForCondition,
} from "./test/app";
import { installSpeechFakes } from "./test/browser";
import { greetingsLesson, userLesson } from "./test/fixtures";

describe("App", () => {
  afterEach(resetApp);

  it("renders the lesson list and opens a lesson detail", async () => {
    const { container } = await renderApp();

    expect(container.textContent).toContain("Greetings & Basics");
    expect(container.textContent).toContain("Daily Routine");
    expect(container.textContent).toContain("3 sentences");

    await act(async () => {
      const button = Array.from(container.querySelectorAll("button")).find(
        (candidate) => candidate.textContent?.includes("Greetings & Basics"),
      );
      button?.click();
    });

    expect(container.textContent).toContain("Good morning, how are you today?");
    expect(container.textContent).toContain("It is nice to meet you.");
    expect(container.textContent).toContain("See you tomorrow.");
    expect(container.textContent).toContain("casual sign-off");
    expect(container.textContent).toContain("Shadow");
    expect(container.textContent).toContain("Dictation");
    // 38 controls (Shadow/Dictation/Fill the blank mode toggle, incl. the 5/10/20 daily-goal toggle, Export CSV, the collapsed Sign in disclosure, the Pronunciation check toggle and a Hide text toggle per sentence) plus one button per word in the three shown transcripts (6 + 6 + 3).
    expect(container.querySelectorAll("button")).toHaveLength(53);
  });

  it("rates a card once when rating buttons are clicked synchronously", async () => {
    const { container } = await openLesson();
    const saveButtons = Array.from(container.querySelectorAll("button")).filter(
      (button) => button.textContent === "Save to review",
    );

    await act(async () => {
      saveButtons[0]?.click();
    });
    await waitForCondition(
      () =>
        Array.from(container.querySelectorAll("button")).filter(
          (button) => button.textContent === "Saved",
        ).length === 1,
    );

    const secondSave = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Save to review",
    );
    await act(async () => {
      secondSave?.click();
    });
    await waitForCondition(
      () =>
        Array.from(container.querySelectorAll("button")).filter(
          (button) => button.textContent === "Saved",
        ).length === 2,
    );

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Review"))
        ?.click();
    });
    await waitForCondition(() => container.textContent?.includes("Show answer") ?? false);

    await act(async () => {
      buttonsNamed(container, "Show answer")[0]?.click();
    });
    await waitForCondition(() => buttonsNamed(container, "Good").length === 1);

    const good = buttonsNamed(container, "Good")[0];
    if (!good) throw new Error("Good rating button not found");
    await act(async () => {
      good.click();
      good.click();
    });

    await waitForCondition(
      () => container.textContent?.includes(greetingsLesson.sentences[1].text) ?? false,
    );
    expect(container.textContent).toContain(greetingsLesson.sentences[1].text);
    expect(container.textContent).not.toContain(greetingsLesson.sentences[0].text);
  });

  it("moves focus to what replaced the control on lesson open, save, Back, show answer, and rating", async () => {
    const { container } = await openLesson();
    await waitForCondition(() => container.querySelector("h1")?.textContent === "Greetings & Basics");
    expect(document.activeElement).toBe(container.querySelector("h1"));

    for (const index of [0, 1]) {
      const save = buttonsNamed(container, "Save to review")[0];
      if (!save) throw new Error("Save to review button not found");
      save.focus();
      await act(async () => {
        save.click();
      });
      await waitForCondition(() => buttonsNamed(container, "Saved").length === index + 1);
      expect(document.activeElement).toBe(save);
      expect(save.getAttribute("aria-label")).toBe("Saved, remove from review deck");
    }

    await act(async () => {
      buttonsNamed(container, "Back to lessons")[0]?.click();
    });
    await waitForCondition(() => buttonsNamed(container, "Back to lessons").length === 0);
    expect(document.activeElement?.tagName).toBe("BUTTON");
    expect(document.activeElement?.textContent).toContain("Greetings & Basics");

    await act(async () => {
      buttonsNamed(container, "Review")[0]?.click();
    });
    await waitForCondition(() => buttonsNamed(container, "Show answer").length === 1);
    await act(async () => {
      buttonsNamed(container, "Show answer")[0]?.click();
    });
    // Sentence cards without notes have an empty back, so identify the answer by position.
    expect(document.activeElement?.tagName).toBe("P");
    expect(document.activeElement?.previousElementSibling?.textContent).toBe(greetingsLesson.sentences[0].text);

    await act(async () => {
      buttonsNamed(container, "Good")[0]?.click();
    });
    await waitForCondition(() => document.activeElement?.textContent === greetingsLesson.sentences[1].text);
    expect(buttonsNamed(container, "Show answer")).toHaveLength(1);

    await act(async () => {
      buttonsNamed(container, "Show answer")[0]?.click();
    });
    await act(async () => {
      buttonsNamed(container, "Good")[0]?.click();
    });
    await waitForCondition(() => document.activeElement?.textContent?.includes("All caught up") ?? false);
  });

  it("restores a signed-in session from /me", async () => {
    const { container } = await renderApp({
      route: (path) => {
        if (path === "/me") {
          return new Response(JSON.stringify({ id: "user-1", email: "restored@example.com" }), {
            status: 200,
          });
        }
      },
    });
    await waitForCondition(() => container.textContent?.includes("restored@example.com") ?? false);
    expect(container.querySelector('input[type="email"]')).toBeNull();
  });

  describe("due refresh on return", () => {
    const visibility = Object.getOwnPropertyDescriptor(document, "visibilityState");

    afterEach(() => {
      vi.useRealTimers();
      restoreProperty(document, "visibilityState", visibility);
    });

    async function renderWithFutureCard() {
      const sentence = greetingsLesson.sentences[0];
      const card = createCard(
        { front: sentence.text, back: "", source: { lessonId: "greetings-basics", sentenceId: sentence.id, word: "" } },
        new Date(),
      );
      await putCard({ ...card, fsrs: { ...card.fsrs, due: new Date(Date.now() + 60_000) } });
      const view = await openLesson();
      await act(async () => {
        buttonsNamed(view.container, "Review")[0]?.click();
      });
      const dueBadge = () => view.container.textContent?.match(/(\d+) due/)?.[1];
      await waitForCondition(() => dueBadge() === "0");
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + 120_000);
      return { ...view, dueBadge };
    }

    function setVisibility(state: DocumentVisibilityState) {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
      document.dispatchEvent(new Event("visibilitychange"));
    }

    it("shows a card that became due when the tab becomes visible, not when it is hidden", async () => {
      const { dueBadge } = await renderWithFutureCard();
      await act(async () => {
        setVisibility("hidden");
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(dueBadge()).toBe("0");
      await act(async () => {
        setVisibility("visible");
      });
      await waitForCondition(() => dueBadge() === "1");
    });

    it("shows a card that became due when the window regains focus", async () => {
      const { dueBadge } = await renderWithFutureCard();
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
      });
      await waitForCondition(() => dueBadge() === "1");
    });
  });

  describe("review data integrity", () => {
    const sentence = greetingsLesson.sentences[0];
    const staleMessage = "This card changed on another device. Showing the latest.";
    const newCard = (front = sentence.text, back = "answer one", sentenceId = sentence.id) =>
      createCard({ front, back, source: { lessonId: "greetings-basics", sentenceId, word: "" } }, new Date());

    afterEach(() => {
      vi.useRealTimers();
    });

    async function press(container: HTMLElement, name: string) {
      const button = buttonsNamed(container, name)[0];
      if (!button) throw new Error(`${name} button not found`);
      await act(async () => {
        button.click();
      });
    }

    async function openReview() {
      const view = await openLesson();
      await press(view.container, "Review");
      await waitForCondition(() => buttonsNamed(view.container, "Show answer").length === 1);
      const unmount = async () => {
        await act(async () => {
          view.root.unmount();
        });
        view.container.remove();
      };
      return { container: view.container, unmount };
    }

    // Every text React painted under `container` since the call, even if a later commit replaced it:
    // added nodes, and text nodes React rewrote in place.
    function addedText(container: HTMLElement) {
      const added: string[] = [];
      const collect = (records: MutationRecord[]) =>
        records.forEach((record) => {
          record.addedNodes.forEach((node) => added.push(node.textContent ?? ""));
          if (record.type === "characterData") {
            added.push(record.target.textContent ?? "");
          }
        });
      const observer = new MutationObserver(collect);
      observer.observe(container, { childList: true, subtree: true, characterData: true });
      return () => {
        collect(observer.takeRecords());
        observer.disconnect();
        return added;
      };
    }

    it("re-saves a removed card with its stored FSRS state and history", async () => {
      const reviewed = reviewCard(newCard(sentence.text, ""), Rating.Good, new Date(Date.now() - 60_000));
      await putCard(reviewed);
      const { container } = await openLesson();
      await waitForCondition(() => buttonsNamed(container, "Saved").length === 1);
      await act(async () => {
        buttonsNamed(container, "Saved")[0]!.click();
      });
      await waitForCondition(() => buttonsNamed(container, "Save to review").length === 3);
      expect((await getAllCards())[0]?.deletedAt).not.toBeNull();

      await act(async () => {
        buttonsNamed(container, "Save to review")[0]!.click();
      });
      await waitForCondition(() => buttonsNamed(container, "Saved").length === 1);
      const [resaved] = await getAllCards();
      expect(resaved?.deletedAt).toBeNull();
      expect(resaved?.fsrs.due).toEqual(reviewed.fsrs.due);
      expect(resaved?.fsrs.reps).toBe(reviewed.fsrs.reps);
      expect(resaved?.fsrs).toEqual(reviewed.fsrs);
      expect(Date.parse(resaved!.updatedAt)).toBeGreaterThan(Date.parse(reviewed.updatedAt));
    });

    it("writes nothing, shows the latest card, and records no XP when the stored card changed", async () => {
      const card = newCard();
      await putCard(card);
      const { container } = await openReview();
      await press(container, "Show answer");
      const changed = { ...card, front: "Changed on another device", updatedAt: new Date(Date.now() + 1000).toISOString() };
      await putCard(changed);
      const recordPractice = vi.spyOn(progressStore, "recordPractice");

      await press(container, "Good");
      await waitForCondition(() => container.textContent?.includes(staleMessage) ?? false);
      expect(await getAllCards()).toEqual([changed]);
      expect(container.textContent).toContain("Changed on another device");
      expect(buttonsNamed(container, "Show answer")).toHaveLength(1);
      expect(recordPractice).not.toHaveBeenCalled();
      expect(await getPracticeDays()).toEqual([]);
    });

    it("does not resurrect a card tombstoned in IndexedDB by a rating", async () => {
      const card = newCard();
      await putCard(card);
      const { container } = await openReview();
      await press(container, "Show answer");
      const tombstone = deleteCard(card, new Date(Date.now() + 1000));
      await putCard(tombstone);
      const recordPractice = vi.spyOn(progressStore, "recordPractice");

      await press(container, "Good");
      await waitForCondition(() => container.textContent?.includes(staleMessage) ?? false);
      expect(await getAllCards()).toEqual([tombstone]);
      expect(container.textContent).toContain("Nothing to review yet.");
      expect(recordPractice).not.toHaveBeenCalled();
    });

    it("renders the next card hidden from its first frame after a rating", async () => {
      await putCard(newCard(sentence.text, "answer one"));
      await putCard(newCard(greetingsLesson.sentences[1].text, "answer two", greetingsLesson.sentences[1].id));
      const { container } = await openReview();
      await press(container, "Show answer");
      expect(container.textContent).toContain("answer one");
      const added = addedText(container);

      await press(container, "Good");
      await waitForCondition(() => container.textContent?.includes(greetingsLesson.sentences[1].text) ?? false);
      await waitForCondition(() => buttonsNamed(container, "Show answer").length === 1);
      expect(added().some((text) => text.includes("answer two"))).toBe(false);
      expect(container.textContent).not.toContain("answer two");
    });

    it("brings a card rated Again back in the session, hidden, when it becomes due", async () => {
      await putCard(newCard());
      const { container } = await openReview();
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], shouldAdvanceTime: true });
      await press(container, "Show answer");

      await press(container, "Again");
      await waitForCondition(() => container.textContent?.includes("All caught up. Next card in 1 min.") ?? false);
      const added = addedText(container);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      await waitForCondition(() => buttonsNamed(container, "Show answer").length === 1);
      expect(container.textContent).toContain(sentence.text);
      expect(added().some((text) => text.includes("answer one"))).toBe(false);
      expect((await getAllCards())[0]?.fsrs.reps).toBe(1);
    });

    it("re-arms a refresh timer that fires before the card is due", async () => {
      await putCard(newCard());
      const { container } = await openReview();
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], shouldAdvanceTime: true });
      await press(container, "Show answer");

      await press(container, "Again");
      await waitForCondition(() => container.textContent?.includes("All caught up. Next card in 1 min.") ?? false);
      // The wall clock steps back 1 s, so the timer fires while the card is still 1 s from due.
      // ponytail: 1 s, not 1 ms: shouldAdvanceTime moves the clock by real elapsed ms, which would make 1 ms reach due.
      vi.setSystemTime(Date.now() - 1_000);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(60_000);
      });
      expect(buttonsNamed(container, "Show answer")).toHaveLength(0);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000);
      });
      await waitForCondition(() => buttonsNamed(container, "Show answer").length === 1);
      expect(container.textContent).toContain(sentence.text);
    });
  });

  describe("daily goal and new-card cap", () => {
    const start = new Date(2026, 0, 5, 12, 0, 0);

    async function seedNewCards(count: number) {
      for (let index = 0; index < count; index += 1) {
        await putCard(
          createCard(
            {
              front: `front ${index}`,
              back: `back ${index}`,
              source: { lessonId: "lesson-1", sentenceId: `s-${String(index).padStart(2, "0")}`, word: "" },
            },
            start,
          ),
        );
      }
    }

    async function openReview(container: HTMLElement) {
      await act(async () => {
        buttonsNamed(container, "Review")[0]?.click();
      });
    }

    afterEach(() => {
      vi.useRealTimers();
      localStorage.clear();
    });

    it("shows the capped due count and shrinks the New allowance after rating a New card", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(start);
      await seedNewCards(21);
      const { container } = await renderApp();
      await openReview(container);
      await waitForCondition(hasText(container, "20 due"));

      await act(async () => {
        buttonsNamed(container, "Show answer")[0]?.click();
      });
      await act(async () => {
        buttonsNamed(container, "Good")[0]?.click();
      });
      await waitForCondition(hasText(container, "19 due"));

      const cards = await getAllCards();
      expect(cards.filter((card) => card.fsrs.state === State.New)).toHaveLength(20);
      expect(container.textContent).toContain("Goal 1/10");
    });

    it("restores the New-card cap on the next local day", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(start);
      await seedNewCards(21);
      for (let index = 0; index < 20; index += 1) {
        await recordPractice(todayKey(start), { newCard: true });
      }
      const first = await renderApp();
      await openReview(first.container);
      await waitForCondition(hasText(first.container, "0 due"));
      expect(first.container.textContent).toContain(
        "Daily limit of 20 new cards reached. 21 new cards are waiting.",
      );
      await first.unmount();

      vi.setSystemTime(new Date(2026, 0, 6, 0, 0, 1));
      const second = await renderApp();
      await openReview(second.container);
      await waitForCondition(hasText(second.container, "20 due"));
      expect(second.container.textContent).toContain("Goal 0/10");
    });

    it("shows goal progress, switches the goal, and persists it", async () => {
      await recordPractice(todayKey(new Date()), { newCard: false });
      await recordPractice(todayKey(new Date()), { newCard: false });
      const { container, unmount } = await renderApp();
      await waitForCondition(hasText(container, "Goal 2/10"));

      await act(async () => {
        buttonsNamed(container, "5")[0]?.click();
      });

      expect(container.textContent).toContain("Goal 2/5");
      expect(localStorage.getItem("road-to-english.dailyGoal")).toBe("5");
      await unmount();

      const remounted = await renderApp();
      await waitForCondition(hasText(remounted.container, "Goal 2/5"));
    });

    it("drops a count loaded before local midnight on the next render", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 0, 5, 23, 59, 0));
      await recordPractice(todayKey(new Date()), { newCard: false });
      const { container } = await renderApp();
      await waitForCondition(hasText(container, "Goal 1/10"));

      vi.setSystemTime(new Date(2026, 0, 6, 0, 0, 1));
      // Changing the goal re-renders without reloading the counts.
      await act(async () => {
        buttonsNamed(container, "5")[0]?.click();
      });

      expect(container.textContent).toContain("Goal 0/5");
    });

    it("shows XP and held freezes from seeded practice", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(start);
      for (let offset = 6; offset >= 0; offset -= 1) {
        await recordPractice(todayKey(new Date(2026, 0, 5 - offset)), { newCard: false });
      }
      await recordPractice(todayKey(start), { newCard: false });
      const { container } = await renderApp();
      await waitForCondition(hasText(container, "80 XP"));

      expect(container.textContent).toContain("7 days streak");
      expect(container.textContent).toContain("Freezes 1/2");
    });

    it("reads a missing or invalid stored goal as 10", async () => {
      localStorage.setItem("road-to-english.dailyGoal", "7");
      const { container } = await renderApp();

      expect(container.textContent).toContain("Goal 0/10");
    });
  });

  describe("user lessons", () => {
    const pasted = "I like green tea.\nDo you   like it?\n\nWe drink it every morning.";

    async function renderLibrary() {
      const view = await renderApp();
      await waitForCondition(hasText(view.container, "Your lessons"));
      return view;
    }

    async function createLesson(container: HTMLElement, title: string, text: string) {
      const titleInput = container.querySelector<HTMLInputElement>("#import-title");
      const textArea = container.querySelector<HTMLTextAreaElement>("#import-text");
      if (!titleInput || !textArea) throw new Error("import form not found");
      expect(container.querySelector('label[for="import-title"]')).not.toBeNull();
      expect(container.querySelector('label[for="import-text"]')).not.toBeNull();
      await act(async () => {
        setInputValue(titleInput, title);
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textArea, text);
        textArea.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => {
        titleInput.form?.requestSubmit();
      });
    }

    function lessonFetches(): string[] {
      return fetchMock.mock.calls
        .map(([input]) => pathOf(input))
        .filter((path) => path.startsWith("/lessons/"));
    }

    it("creates a lesson from pasted text, opens it without a lesson fetch, and lists it after a remount", async () => {
      const first = await renderLibrary();
      expect(first.container.textContent).toContain("Your lessons stay on this device; export a backup to move them.");
      expect(buttonsNamed(first.container, "A1")[0]?.getAttribute("aria-pressed")).toBe("false");
      expect(buttonsNamed(first.container, "B1")[0]?.getAttribute("aria-pressed")).toBe("true");
      expect(buttonsNamed(first.container, "110 WPM")[0]?.getAttribute("aria-pressed")).toBe("true");
      await act(async () => {
        buttonsNamed(first.container, "B2")[0]?.click();
        buttonsNamed(first.container, "130 WPM")[0]?.click();
      });

      await createLesson(first.container, "  Tea talk ", pasted);
      await waitForCondition(() => first.container.textContent?.includes("Back to lessons") ?? false);

      expect(first.container.textContent).toContain("Tea talk");
      expect(first.container.textContent).toContain("Level B2");
      expect(first.container.textContent).toContain("130 WPM");
      for (const sentence of ["I like green tea.", "Do you like it?", "We drink it every morning."]) {
        expect(first.container.textContent).toContain(sentence);
      }
      const [stored] = await listUserLessons();
      expect(stored).toMatchObject({
        title: "Tea talk",
        level: "B2",
        targetWpm: 130,
        sentences: [
          { id: "s1", text: "I like green tea.", vi: "" },
          { id: "s2", text: "Do you like it?", vi: "" },
          { id: "s3", text: "We drink it every morning.", vi: "" },
        ],
      });
      expect(stored?.id).toMatch(/^user-[0-9a-f-]{36}$/);
      expect(lessonFetches()).toEqual([]);
      await close(first);

      // The route keeps the created lesson open on a reload; a fresh visit to the app root lists it.
      window.history.replaceState(null, "", "/");
      const second = await renderLibrary();
      await waitForCondition(() => second.container.textContent?.includes("Tea talk") ?? false);
      expect(second.container.textContent).toContain("B2 · 3 sentences");
      await act(async () => {
        Array.from(second.container.querySelectorAll("button"))
          .find((button) => button.textContent?.includes("Tea talk"))
          ?.click();
      });
      expect(second.container.textContent).toContain("We drink it every morning.");
      expect(lessonFetches()).toEqual([]);
    });

    it("saves a word whose back is the sentence text only, then deletes the lesson and keeps the card", async () => {
      installSpeechFakes();
      const view = await renderLibrary();
      await createLesson(view.container, "Tea talk", pasted);
      await waitForCondition(() => buttonsNamed(view.container, "green").length === 1);

      await act(async () => {
        buttonsNamed(view.container, "green")[0]?.click();
      });
      await act(async () => {
        buttonsNamed(view.container, "Save word")[0]?.click();
      });
      await waitForCondition(() => buttonsNamed(view.container, "Saved").length === 1);
      const [lesson] = await listUserLessons();
      const [card] = await getAllCards();
      expect(card).toMatchObject({
        id: `${lesson?.id}:s1:green`,
        front: "green",
        back: "I like green tea.",
      });

      await act(async () => {
        buttonsNamed(view.container, "Back to lessons")[0]?.click();
      });
      const confirm = vi.fn(() => false);
      vi.stubGlobal("confirm", confirm);
      await act(async () => {
        buttonsNamed(view.container, "Delete")[0]?.click();
      });
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(await listUserLessons()).toHaveLength(1);

      confirm.mockReturnValue(true);
      await act(async () => {
        buttonsNamed(view.container, "Delete")[0]?.click();
      });
      await waitForCondition(() => view.container.textContent?.includes("No lessons of your own yet.") ?? false);
      expect(document.activeElement?.textContent).toBe("Your lessons");
      expect(await listUserLessons()).toEqual([]);
      expect(await getAllCards()).toEqual([card]);
      await close(view);

      const remounted = await renderLibrary();
      expect(remounted.container.textContent).toContain("No lessons of your own yet.");
      expect(remounted.container.textContent).not.toContain("Tea talk");
    });

    it("creates only one lesson on a synchronous double submit", async () => {
      const first = await renderLibrary();
      const titleInput = first.container.querySelector<HTMLInputElement>("#import-title");
      const textArea = first.container.querySelector<HTMLTextAreaElement>("#import-text");
      if (!titleInput || !textArea) throw new Error("import form not found");
      await act(async () => {
        setInputValue(titleInput, "Tea talk");
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textArea, pasted);
        textArea.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => {
        titleInput.form?.requestSubmit();
        titleInput.form?.requestSubmit();
      });
      await waitForCondition(() => first.container.textContent?.includes("Back to lessons") ?? false);
      await close(first);

      // The route keeps the created lesson open on a reload; a fresh visit to the app root lists it.
      window.history.replaceState(null, "", "/");
      const second = await renderLibrary();
      await waitForCondition(() => second.container.textContent?.includes("Tea talk") ?? false);
      expect(
        Array.from(second.container.querySelectorAll("button")).filter((button) => button.textContent?.includes("Tea talk")),
      ).toHaveLength(1);
      expect(await listUserLessons()).toHaveLength(1);
    });

    it.each([
      ["NUL in the text", "Tea talk", "I like\u0000 tea.", "Title and text must not contain NUL characters."],
      ["an empty title", "   ", pasted, "Title must be 1-100 characters."],
      ["over-limit text", "Tea talk", "a".repeat(20001), "Text must be at most 20000 characters."],
      ["too many sentences", "Tea talk", "Go. ".repeat(201), "Text must contain 1-200 sentences."],
      ["no sentences", "Tea talk", "... !!!", "Text must contain 1-200 sentences."],
    ])("shows an inline error and stores nothing for %s", async (_name, title, text, message) => {
      const view = await renderLibrary();
      await createLesson(view.container, title, text);

      expect(view.container.textContent).toContain(message);
      expect(view.container.textContent).not.toContain("Back to lessons");
      expect(await listUserLessons()).toEqual([]);
      await close(view);
    });

    it("returns to the library after importing a backup while a user lesson is open", async () => {
      const view = await renderLibrary();
      await createLesson(view.container, "Tea talk", pasted);
      await waitForCondition(() => view.container.textContent?.includes("Back to lessons") ?? false);
      const text = exportData(
        { cards: [], practiceDays: [], lessonCompletion: [], userLessons: [] },
        new Date(),
      );
      vi.stubGlobal("confirm", () => true);
      const input = view.container.querySelector<HTMLInputElement>('input[type="file"]');
      if (!input) throw new Error("backup file input not found");
      await act(async () => {
        Object.defineProperty(input, "files", {
          configurable: true,
          value: [new File([text], "backup.json", { type: "application/json" })],
        });
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await waitForCondition(() => !(view.container.textContent?.includes("Back to lessons") ?? true));
      expect(window.location.hash).toBe("#/");
      expect(document.activeElement).toBe(view.container.querySelector("main h1"));
      expect(view.container.textContent).toContain("Your lessons");
      expect(view.container.textContent).not.toContain("I like green tea.");
      expect(await listUserLessons()).toEqual([]);
    });

    it("runs dictation and the fill-the-blank drill on a user lesson", async () => {
      vi.stubGlobal("speechSynthesis", { speak: vi.fn(), cancel: vi.fn() });
      vi.stubGlobal("SpeechSynthesisUtterance", class {});
      const view = await renderLibrary();
      await createLesson(view.container, "Tea talk", pasted);
      await waitForCondition(() => view.container.textContent?.includes("Back to lessons") ?? false);

      await act(async () => {
        buttonsNamed(view.container, "Dictation")[0]?.click();
      });
      expect(view.container.textContent).not.toContain("I like green tea.");
      const dictation = view.container.querySelector<HTMLInputElement>("#dictation-s1");
      if (!dictation) throw new Error("dictation input not found");
      await act(async () => {
        setInputValue(dictation, "i like green tea");
        dictation.form?.requestSubmit();
      });
      expect(view.container.textContent).toContain("Reference: I like green tea.");
      expect(view.container.textContent).toContain("Correct");

      await act(async () => {
        buttonsNamed(view.container, "Fill the blank")[0]?.click();
      });
      const { parts, index } = blankFor("We drink it every morning.");
      expect(view.container.textContent).toContain(
        parts.map((part, i) => (i === index ? "____blank" : part)).join(""),
      );
      const blank = view.container.querySelector<HTMLInputElement>("#blank-s3");
      if (!blank) throw new Error("blank input not found");
      await act(async () => {
        setInputValue(blank, parts[index]!);
        blank.form?.requestSubmit();
      });
      expect(view.container.textContent).toContain("Correct");
      expect(lessonFetches()).toEqual([]);
    });
  });

  describe("storage failures, retry, and dead ends", () => {
    const storageLine = "Your saved data couldn't be read or saved on this device";

    async function openGreetings(container: HTMLElement) {
      await waitForCondition(() => buttonsNamed(container, "Greetings & Basics").length > 0 || hasText(container, "Greetings & Basics")());
      await act(async () => {
        Array.from(container.querySelectorAll("button"))
          .find((button) => button.textContent?.includes("Greetings & Basics"))
          ?.click();
      });
      await waitForCondition(() => container.querySelector("h1")?.textContent === "Greetings & Basics");
    }

    it("shows the storage line and no endless loading when the deck fails to load", async () => {
      vi.spyOn(vocabStore, "getAllCards").mockRejectedValue(new Error("IndexedDB is unavailable"));
      const { container } = await renderApp();
      await waitForCondition(hasText(container, storageLine));
      expect(container.textContent).toContain(`${storageLine}: IndexedDB is unavailable. Reload to try again.`);

      await click(container, "Review");
      expect(container.textContent).not.toContain("Loading review deck...");
      expect(container.textContent).toContain("Your review deck couldn't be loaded.");
      expect(container.textContent).not.toContain("Nothing to review yet");
    });

    it("shows the storage line when progress fails to load", async () => {
      vi.spyOn(progressStore, "getPracticeDays").mockRejectedValue(new Error("progress store broke"));
      const { container } = await renderApp();
      await waitForCondition(hasText(container, `${storageLine}: progress store broke.`));
      expect(container.textContent).toContain("Greetings & Basics");
    });

    it("shows an error instead of loading forever when your lessons fail to load", async () => {
      vi.spyOn(userLessonsStore, "listUserLessons").mockRejectedValue(new Error("lessons store broke"));
      const { container } = await renderApp();
      await waitForCondition(hasText(container, "Unable to load your lessons: lessons store broke"));
      expect(container.textContent).not.toContain("Loading your lessons...");
      expect(container.textContent).toContain(`${storageLine}: lessons store broke.`);
    });

    it("recovers Save to review and Save word after a failed write", async () => {
      installSpeechFakes();
      const { container } = await renderApp();
      await openGreetings(container);
      const saveCard = vi.spyOn(vocabStore, "saveCard").mockRejectedValueOnce(new Error("quota"));

      const save = await click(container, "Save to review");
      await waitForCondition(hasText(container, "Couldn't save. Try again."));
      expect(save.getAttribute("aria-disabled")).not.toBe("true");
      expect(save.disabled).toBe(false);
      await click(container, "Save to review");
      await waitForCondition(() => buttonsNamed(container, "Saved").length === 1);
      expect(container.textContent).not.toContain("Couldn't save.");

      await click(container, "morning");
      saveCard.mockRejectedValueOnce(new Error("quota"));
      await click(container, "Save word");
      await waitForCondition(hasText(container, "Couldn't save. Try again."));
      await click(container, "Save word");
      await waitForCondition(() => buttonsNamed(container, "Saved").length === 2);
      expect(container.textContent).not.toContain("Couldn't save.");
    });

    it("recovers rating in Review after a failed write", async () => {
      await putCard(
        createCard({ front: "front", back: "back", source: { lessonId: "l", sentenceId: "s", word: "" } }, new Date()),
      );
      const { container } = await renderApp();
      await click(container, "Review");
      await waitForCondition(() => buttonsNamed(container, "Show answer").length === 1);
      await click(container, "Show answer");
      vi.spyOn(vocabStore, "saveReview").mockRejectedValueOnce(new Error("quota"));
      await click(container, "Good");
      await waitForCondition(hasText(container, "Couldn't save. Try again."));
      expect(buttonsNamed(container, "Good")[0]?.disabled).toBe(false);
      await click(container, "Good");
      await waitForCondition(hasText(container, "All caught up"));
      expect((await getAllCards())[0]?.fsrs.reps).toBe(1);
    });

    it("reports a failed progress write after a saved rating in the header, not as a rating failure", async () => {
      await putCard(
        createCard({ front: "front", back: "back", source: { lessonId: "l", sentenceId: "s", word: "" } }, new Date()),
      );
      const { container } = await renderApp();
      await click(container, "Review");
      await waitForCondition(() => buttonsNamed(container, "Show answer").length === 1);
      await click(container, "Show answer");
      vi.spyOn(progressStore, "recordPractice").mockRejectedValueOnce(new Error("quota"));
      await click(container, "Good");
      await waitForCondition(hasText(container, `${storageLine}: quota.`));
      await waitForCondition(hasText(container, "All caught up"));
      expect(container.textContent).not.toContain("Couldn't save.");
      expect((await getAllCards())[0]?.fsrs.reps).toBe(1);
    });

    it("shows the header line when a dictation practice write fails", async () => {
      const { container } = await renderApp();
      await openGreetings(container);
      await click(container, "Dictation");
      vi.spyOn(progressStore, "recordPractice").mockRejectedValueOnce(new Error("disk full"));
      const input = container.querySelector<HTMLInputElement>(`#dictation-${greetingsLesson.sentences[0].id}`);
      if (!input) throw new Error("dictation input not found");
      await act(async () => {
        setInputValue(input, "Good morning");
        input.form?.requestSubmit();
      });
      await waitForCondition(hasText(container, `${storageLine}: disk full. Reload to try again.`));
      expect(container.textContent).toContain("Goal 0/10");
    });

    it("recovers Mark complete after a failed write", async () => {
      const { container } = await renderApp();
      await openGreetings(container);
      vi.spyOn(progressStore, "markLessonComplete").mockRejectedValueOnce(new Error("quota"));
      await click(container, "Mark complete");
      await waitForCondition(hasText(container, "Couldn't save. Try again."));
      await click(container, "Mark complete");
      await waitForCondition(() => buttonsNamed(container, "Completed").length === 1);
      expect(container.textContent).not.toContain("Couldn't save.");
    });

    it("recovers Delete lesson after a failed write", async () => {
      await putUserLesson(userLesson);
      vi.stubGlobal("confirm", () => true);
      const { container } = await renderApp();
      await waitForCondition(hasText(container, userLesson.title));
      vi.spyOn(userLessonsStore, "deleteUserLesson").mockRejectedValueOnce(new Error("quota"));
      const del = () => container.querySelector<HTMLButtonElement>(`button[aria-label="Delete ${userLesson.title}"]`);
      await act(async () => {
        del()?.click();
      });
      await waitForCondition(hasText(container, "Couldn't delete. Try again."));
      await act(async () => {
        del()?.click();
      });
      await waitForCondition(hasText(container, "No lessons of your own yet."));
      expect(container.textContent).not.toContain("Couldn't delete.");
    });

    it("keeps the Create error line when saving a lesson fails", async () => {
      vi.spyOn(userLessonsStore, "putUserLesson").mockRejectedValueOnce(new Error("quota exceeded"));
      const { container } = await renderApp();
      const title = container.querySelector<HTMLInputElement>("#import-title");
      const text = container.querySelector<HTMLTextAreaElement>("#import-text");
      if (!title || !text) throw new Error("import form not found");
      await act(async () => {
        setInputValue(title, "Mine");
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
        setter?.call(text, "I like tea. You like coffee.");
        text.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await click(container, "Create");
      await waitForCondition(hasText(container, "quota exceeded"));
      await click(container, "Create");
      await waitForCondition(() => container.querySelector("h1")?.textContent === "Mine");
    });

    it("never paints Lesson unavailable while a library lesson loads", async () => {
      const seen: string[] = [];
      const { container } = await renderApp();
      const observer = new MutationObserver(() => seen.push(container.textContent ?? ""));
      observer.observe(container, { childList: true, subtree: true, characterData: true });
      await openGreetings(container);
      observer.disconnect();
      expect(seen.some((text) => text.includes("Loading lesson..."))).toBe(true);
      expect(seen.some((text) => text.includes("Lesson unavailable"))).toBe(false);
    });

    it("drops a pending return focus when the view changes before the rows mount", async () => {
      let release: () => void = () => undefined;
      let lessonsCalls = 0;
      const { container } = await renderApp({ route: async (path) => {
        if (path === "/lessons" && ++lessonsCalls > 2) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return responseFor(path);
      } });
      await openGreetings(container);
      await click(container, "Back to lessons");
      expect(container.textContent).toContain("Loading lessons...");
      await click(container, "Review");
      const libraryToggle = await click(container, "Library");
      libraryToggle.focus();
      await act(async () => {
        release();
      });
      await waitForCondition(hasText(container, "Daily Routine"));
      expect(document.activeElement).toBe(libraryToggle);
    });
  });

  describe("sync status, session loss, and account errors", () => {
    const originalStorage = Object.getOwnPropertyDescriptor(navigator, "storage");

    afterEach(() => {
      restoreProperty(navigator, "storage", originalStorage);
    });

    it("shows a friendly line when /me is offline and signs in when an online event retries it", async () => {
      let offline = true;
      const { container } = await renderApp({ route: (path) => {
        if (path === "/me") {
          if (offline) throw new TypeError("Failed to fetch");
          return userResponse();
        }
        return undefined;
      } });
      await waitForCondition(() => container.textContent?.includes("Can't reach the server. You can keep practising on this device.") ?? false);
      expect(container.textContent).not.toContain("Failed to fetch");

      offline = false;
      await act(async () => {
        window.dispatchEvent(new Event("online"));
      });
      await waitForCondition(() => container.textContent?.includes("restored@example.com") ?? false);
      expect(container.textContent).not.toContain("Can't reach the server");
    });

    it("does not retry /me on online after a server error", async () => {
      const { container } = await renderApp({ route: (path) => (path === "/me" ? new Response(null, { status: 500 }) : undefined) });
      await waitForCondition(() => container.textContent?.includes("Unable to complete account request. Please try again.") ?? false);
      const before = callsTo("/me");

      await act(async () => {
        window.dispatchEvent(new Event("online"));
      });
      expect(callsTo("/me")).toBe(before);
    });

    const kept = "Storage: kept on this device.";
    const mayClear = "Storage: the browser may clear this data when space is low. Export a backup or sign in to keep it.";

    it.each([
      ["granted", () => Promise.resolve(true), kept],
      ["denied", () => Promise.resolve(false), mayClear],
      ["rejected", () => Promise.reject(new Error("blocked")), mayClear],
      ["absent", undefined, mayClear],
    ] as const)("shows the storage line when persistence is %s", async (_name, persist, expected) => {
      const persistMock = persist && vi.fn(persist);
      Object.defineProperty(navigator, "storage", {
        configurable: true,
        value: persistMock ? { persist: persistMock } : undefined,
      });
      const { container } = await renderApp();
      await waitForCondition(() => container.textContent?.includes(expected) ?? false);
      if (persistMock) {
        expect(persistMock).toHaveBeenCalledTimes(1);
      }
      expect(container.textContent).not.toContain("blocked");
    });
  });

  describe("accessibility", () => {
    // Heading levels in document order, which must start at 1 and never skip a level going down.
    function headingLevels(container: HTMLElement): number[] {
      return Array.from(container.querySelectorAll("h1, h2, h3, h4, h5, h6")).map((heading) => Number(heading.tagName[1]));
    }

    function expectNoSkippedLevels(container: HTMLElement) {
      const levels = headingLevels(container);
      expect(levels[0]).toBe(1);
      levels.forEach((level, index) => {
        expect(level - (levels[index - 1] ?? 0)).toBeLessThanOrEqual(1);
      });
    }

    it("names the view in its one h1, focuses it on a view change, and keeps the landmarks", async () => {
      const view = await renderApp();
      const { container } = view;
      await waitForCondition(() => buttonsNamed(container, "Start lesson").length === 1);
      expect(h1Texts(container)).toEqual(["Lesson library"]);
      expect(document.activeElement).toBe(document.body);
      expect(container.querySelectorAll("main")).toHaveLength(1);
      expect(container.querySelectorAll("header")).toHaveLength(1);
      expect(container.querySelector("header")?.contains(container.querySelector("main"))).toBe(false);
      expect(container.querySelector("nav")?.getAttribute("aria-label")).toBe("Views");
      expect(container.querySelector("main h1")).not.toBeNull();
      expectNoSkippedLevels(container);

      await click(container, "Review");
      expect(h1Texts(container)).toEqual(["Review deck"]);
      expect(document.activeElement).toBe(container.querySelector("h1"));
      expectNoSkippedLevels(container);

      await waitForCondition(() => buttonsNamed(container, "Go to library").length === 1);
      await click(container, "Go to library");
      expect(h1Texts(container)).toEqual(["Lesson library"]);
      expect(document.activeElement).toBe(container.querySelector("h1"));

      await waitForCondition(() => buttonsNamed(container, "Start lesson").length === 1);
      await click(container, "Start lesson");
      await waitForCondition(() => h1Texts(container)[0] === "Greetings & Basics");
      expect(h1Texts(container)).toEqual(["Greetings & Basics"]);
      expect(document.activeElement).toBe(container.querySelector("main h1"));
      expectNoSkippedLevels(container);
    });

    it("announces results in polite regions mounted before them, and errors as alerts", async () => {
      const view = await openLesson();
      const { container } = view;
      await waitForCondition(() => h1Texts(container)[0] === "Greetings & Basics");
      // Astryx buttons carry their own empty aria-live status spans; the app's regions are the others.
      // The goal region stays quiet on practice; the Goal badge sits outside it.
      const goal = container.querySelector('header [role="status"]:not([aria-live])');
      expect(goal?.textContent).toBe("");
      expect(container.querySelector("header")?.textContent).toContain("Goal 0/10");

      await click(container, "Dictation");
      const input = container.querySelector<HTMLInputElement>("#dictation-greetings-basics-1");
      if (!input) throw new Error("dictation input not found");
      const card = input.closest("li")!;
      const region = card.querySelector('[role="status"]:not([aria-live])');
      expect(region?.textContent).toBe("");

      await act(async () => {
        setInputValue(input, "Good morning");
        input.form?.requestSubmit();
      });
      expect(card.querySelectorAll('[role="status"]:not([aria-live])')).toHaveLength(1);
      expect(card.querySelector('[role="status"]:not([aria-live])')).toBe(region);
      expect(region?.textContent).toContain("Not quite");
      expect(region?.querySelector("button")).toBeNull();
      await waitForCondition(() => container.querySelector("header")?.textContent?.includes("Goal 1/10") ?? false);
      expect(container.querySelector('header [role="status"]:not([aria-live])')).toBe(goal);
      expect(goal?.textContent).toBe("");

      await click(card, "Try again");
      expect(region?.textContent).toBe("");
      expect(document.activeElement).toBe(input);

      vi.spyOn(backupStore, "exportBackupData").mockRejectedValueOnce(new Error("export broke"));
      await click(container, "Export");
      await waitForCondition(() => container.textContent?.includes("Backup error: export broke") ?? false);
      const error = Array.from(container.querySelectorAll("p")).find((p) => p.textContent === "Backup error: export broke");
      expect(error?.getAttribute("role")).toBe("alert");
    });

    it("marks Vietnamese lang=vi in the lesson and in a word card's answer", async () => {
      const sentence = greetingsLesson.sentences[0];
      await putCard(
        createCard(
          { front: "morning", back: `${sentence.text} — ${sentence.vi}`, source: { lessonId: "greetings-basics", sentenceId: sentence.id, word: "morning" } },
          new Date(),
        ),
      );
      const view = await openLesson();
      const { container } = view;
      await waitForCondition(() => h1Texts(container)[0] === "Greetings & Basics");
      expect(container.querySelectorAll("[lang]")).toHaveLength(0);
      await click(container, "Show Vietnamese");
      expect(Array.from(container.querySelectorAll("[lang]")).map((node) => [node.getAttribute("lang"), node.textContent])).toEqual(
        greetingsLesson.sentences.map(({ vi }) => ["vi", vi]),
      );

      await click(container, "Review");
      await waitForCondition(() => buttonsNamed(container, "Show answer").length === 1);
      await click(container, "Show answer");
      const answer = container.querySelector('main [lang="vi"]')?.parentElement;
      expect(answer?.textContent).toBe(`${sentence.text} — ${sentence.vi}`);
      expect(Array.from(container.querySelectorAll("[lang]")).map((node) => [node.getAttribute("lang"), node.textContent])).toEqual([
        ["vi", sentence.vi],
      ]);
    });

    it("returns focus from a toast's Undo to the Saved toggle it undid", async () => {
      const view = await openLesson();
      const { container } = view;
      await waitForCondition(() => buttonsNamed(container, "Save to review").length === 3);
      const toggle = buttonsNamed(container, "Save to review")[0]!;
      await click(container, "Save to review");
      await waitForCondition(() => buttonsNamed(container, "Saved").length === 1);
      // Toasts render outside the container, and earlier tests may leave theirs behind.
      const undos = buttonsNamed(document.body, "Undo").length;
      await click(container, "Saved");
      await waitForCondition(() => buttonsNamed(document.body, "Undo").length === undos + 1);
      const undo = buttonsNamed(document.body, "Undo").at(-1)!;
      undo.focus();
      await act(async () => {
        undo.click();
      });
      await waitForCondition(() => buttonsNamed(container, "Saved").length === 1);
      await waitForCondition(() => document.activeElement === toggle);
    });

    it("moves focus to the card after a rating that fails to save", async () => {
      await putCard(
        createCard({ front: "front", back: "back", source: { lessonId: "l", sentenceId: "s", word: "" } }, new Date()),
      );
      const view = await renderApp();
      const { container } = view;
      await click(container, "Review");
      await waitForCondition(() => buttonsNamed(container, "Show answer").length === 1);
      await click(container, "Show answer");
      vi.spyOn(vocabStore, "saveReview").mockRejectedValueOnce(new Error("quota"));
      const good = buttonsNamed(container, "Good")[0]!;
      good.focus();
      await click(container, "Good");
      await waitForCondition(() => container.textContent?.includes("Couldn't save. Try again.") ?? false);
      await waitForCondition(() => document.activeElement?.textContent === "front");
    });

    it("restores the view from the route on load without taking focus", async () => {
      window.history.replaceState(null, "", "#/lesson/greetings-basics");
      const lesson = await renderApp();
      await waitForCondition(() => h1Texts(lesson.container)[0] === "Greetings & Basics");
      expect(document.activeElement).toBe(document.body);
      expect(document.title).toBe("Greetings & Basics · Road to English");
      await close(lesson);

      window.history.replaceState(null, "", "#/review");
      const review = await renderApp();
      expect(h1Texts(review.container)).toEqual(["Review deck"]);
      expect(document.title).toBe("Review deck · Road to English");
      expect(document.activeElement).toBe(document.body);
    });

    it("focuses the library heading on Back to lessons from an unknown lesson id", async () => {
      const view = await renderApp();
      await waitForCondition(() => buttonsNamed(view.container, "Start lesson").length === 1);
      routeFetch((path) =>
        path === "/lessons/nope" ? new Response(JSON.stringify({ error: "lesson not found" }), { status: 404 }) : undefined,
      );
      await act(async () => {
        window.location.hash = "#/lesson/nope";
      });
      await waitForCondition(() => h1Texts(view.container)[0] === "Lesson unavailable");
      await click(view.container, "Back to lessons");
      await waitForCondition(() => h1Texts(view.container)[0] === "Lesson library");
      await waitForCondition(() => document.activeElement?.tagName === "H1");
      expect(document.activeElement?.textContent).toBe("Lesson library");
    });

    it("focuses the library heading once your lessons load last after Back from an unknown lesson id", async () => {
      let resolveUserLessons: (lessons: Awaited<ReturnType<typeof listUserLessons>>) => void = () => undefined;
      vi.spyOn(userLessonsStore, "listUserLessons").mockImplementation(
        () => new Promise((resolve) => (resolveUserLessons = resolve)),
      );
      window.history.replaceState(null, "", "#/lesson/nope");
      const view = await renderApp({
        route: (path) =>
          path === "/lessons/nope" ? new Response(JSON.stringify({ error: "lesson not found" }), { status: 404 }) : undefined,
      });
      const { container } = view;
      await waitForCondition(() => h1Texts(container)[0] === "Lesson unavailable");
      await click(container, "Back to lessons");
      await waitForCondition(() => buttonsNamed(container, "Start lesson").length === 1);
      expect(container.textContent).toContain("Loading your lessons...");
      expect(document.activeElement?.tagName).not.toBe("H1");
      await act(async () => {
        resolveUserLessons([]);
      });
      await waitForCondition(() => document.activeElement?.tagName === "H1");
      expect(document.activeElement?.textContent).toBe("Lesson library");
    });

    it("falls back to the library with replaceState for a malformed route or an unknown user lesson", async () => {
      for (const hash of ["#/nowhere", "#/lesson/", "#/my/user-missing"]) {
        window.history.replaceState(null, "", hash);
        const length = window.history.length;
        const view = await renderApp();
        await waitForCondition(() => window.location.hash === "#/");
        expect(h1Texts(view.container)).toEqual(["Lesson library"]);
        expect(window.history.length).toBe(length);
        await close(view);
      }
    });

    it("returns from a deep-linked lesson with Back to lessons by pushing the library, not leaving the app", async () => {
      window.history.replaceState(null, "", "#/lesson/greetings-basics");
      const view = await renderApp();
      const { container } = view;
      await waitForCondition(() => h1Texts(container)[0] === "Greetings & Basics");
      const length = window.history.length;
      await click(container, "Back to lessons");
      await waitForCondition(() => h1Texts(container)[0] === "Lesson library");
      expect(window.location.hash).toBe("#/");
      expect(window.history.length).toBe(length + 1);
      await waitForCondition(() => document.activeElement?.textContent?.includes("Greetings & Basics") ?? false);
      expect(document.activeElement?.tagName).toBe("BUTTON");
    });

    it("pushes a history entry per view change and follows browser Back and Forward", async () => {
      const view = await renderApp();
      const { container } = view;
      await waitForCondition(() => buttonsNamed(container, "Start lesson").length === 1);
      expect(document.title).toBe("Lesson library · Road to English");
      await act(async () => {
        Array.from(container.querySelectorAll("main li button"))
          .find((button) => button.textContent?.includes("Greetings & Basics"))
          ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      });
      await waitForCondition(() => h1Texts(container)[0] === "Greetings & Basics");
      expect(window.location.hash).toBe("#/lesson/greetings-basics");

      // Browser Back: the library, with focus on the row of the lesson just left.
      await act(async () => {
        window.history.back();
      });
      await waitForCondition(() => h1Texts(container)[0] === "Lesson library");
      await waitForCondition(() => document.activeElement?.textContent?.includes("Greetings & Basics") ?? false);
      expect(document.activeElement?.tagName).toBe("BUTTON");

      // Browser Forward: the lesson again, with focus on its h1.
      await act(async () => {
        window.history.forward();
      });
      await waitForCondition(() => h1Texts(container)[0] === "Greetings & Basics");
      expect(document.activeElement).toBe(container.querySelector("main h1"));

      await click(container, "Review");
      expect(window.location.hash).toBe("#/review");
      await act(async () => {
        window.history.back();
      });
      await waitForCondition(() => h1Texts(container)[0] === "Greetings & Basics");
      expect(document.activeElement).toBe(container.querySelector("main h1"));
    });

    it("leaves focus where the user moved it while an Undo was saving", async () => {
      const view = await openLesson();
      const { container } = view;
      await waitForCondition(() => buttonsNamed(container, "Save to review").length === 3);
      await click(container, "Save to review");
      await waitForCondition(() => buttonsNamed(container, "Saved").length === 1);
      // Earlier tests can leave toasts behind, and the viewport caps how many show.
      const earlier = new Set(buttonsNamed(document.body, "Undo"));
      const newUndo = () => buttonsNamed(document.body, "Undo").find((button) => !earlier.has(button));
      await click(container, "Saved");
      await waitForCondition(() => newUndo() !== undefined);
      const undo = newUndo()!;
      const elsewhere = buttonsNamed(container, "Dictation")[0]!;
      undo.focus();
      await act(async () => {
        undo.click();
        elsewhere.focus();
      });
      await waitForCondition(() => buttonsNamed(container, "Saved").length === 1);
      expect(document.activeElement).toBe(elsewhere);
    });

    it("does not announce a daily goal that was already met when the page loads", async () => {
      for (let index = 0; index < 12; index += 1) {
        await recordPractice(todayKey(new Date()), { newCard: false });
      }
      const view = await renderApp();
      const { container } = view;
      await waitForCondition(() => container.querySelector("header")?.textContent?.includes("Goal 12/10") ?? false);
      await waitForCondition(() => buttonsNamed(container, "Start lesson").length === 1);
      expect(container.querySelector('header [role="status"]:not([aria-live])')!.textContent).toBe("");
    });

    it("announces the daily goal only when it becomes met, not on each practice action", async () => {
      localStorage.setItem("road-to-english.dailyGoal", "5");
      for (let index = 0; index < 3; index += 1) {
        await recordPractice(todayKey(new Date()), { newCard: false });
      }
      const view = await openLesson();
      const { container } = view;
      await waitForCondition(() => h1Texts(container)[0] === "Greetings & Basics");
      const goal = container.querySelector('header [role="status"]:not([aria-live])')!;
      await click(container, "Dictation");
      const submit = async (id: string) => {
        const input = container.querySelector<HTMLInputElement>(`#dictation-${id}`)!;
        await act(async () => {
          setInputValue(input, "Good morning");
          input.form?.requestSubmit();
        });
      };
      await submit("greetings-basics-1");
      await waitForCondition(() => container.querySelector("header")?.textContent?.includes("Goal 4/5") ?? false);
      expect(goal.textContent).toBe("");
      await submit("greetings-basics-2");
      await waitForCondition(() => container.querySelector("header")?.textContent?.includes("Goal 5/5") ?? false);
      expect(goal.textContent).toBe("Daily goal met.");
      localStorage.removeItem("road-to-english.dailyGoal");
    });

    it("does not announce the daily goal when a reload after practice meets it", async () => {
      localStorage.setItem("road-to-english.dailyGoal", "5");
      for (let index = 0; index < 3; index += 1) {
        await recordPractice(todayKey(new Date()), { newCard: false });
      }
      vi.stubGlobal("confirm", () => true);
      const view = await openLesson();
      const { container } = view;
      await waitForCondition(() => h1Texts(container)[0] === "Greetings & Basics");
      await click(container, "Dictation");
      const input = container.querySelector<HTMLInputElement>("#dictation-greetings-basics-1")!;
      await act(async () => {
        setInputValue(input, "Good morning");
        input.form?.requestSubmit();
      });
      await waitForCondition(() => container.querySelector("header")?.textContent?.includes("Goal 4/5") ?? false);
      // Another tab's practice lands in the store; the import reload picks it up with no practice here.
      await recordPractice(todayKey(new Date()), { newCard: false });
      const text = exportData({ cards: [], practiceDays: [], lessonCompletion: [], userLessons: [] }, new Date());
      const file = container.querySelector<HTMLInputElement>('input[type="file"]')!;
      await act(async () => {
        Object.defineProperty(file, "files", {
          configurable: true,
          value: [new File([text], "backup.json", { type: "application/json" })],
        });
        file.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await waitForCondition(() => container.querySelector("header")?.textContent?.includes("Goal 5/5") ?? false);
      expect(container.querySelector('header [role="status"]:not([aria-live])')!.textContent).toBe("");
      localStorage.removeItem("road-to-english.dailyGoal");
    });

  });
});
