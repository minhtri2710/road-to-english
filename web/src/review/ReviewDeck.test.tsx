import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { todayKey } from "../lib/progress";
import { recordPractice } from "../lib/progressStore";
import { createCard, Rating, State, type VocabCard } from "../lib/vocab";
import * as vocabStore from "../lib/vocabStore";
import { getAllCards, putCard } from "../lib/vocabStore";
import {
  buttonsNamed,
  click,
  hasText,
  renderApp,
  resetApp,
  waitForCondition,
} from "../test/app";
import { installSpeechFakes, removeBrowserGlobals } from "../test/browser";
import { deferred } from "../test/fixtures";

// Due 1 ms apart, in the order given.
async function openReview(...fronts: string[]) {
  const start = Date.now() - 1_000;
  for (const [index, front] of fronts.entries()) {
    await putCard(
      createCard({ front, back: `${front} back`, source: { lessonId: "l", sentenceId: front, word: "" } }, new Date(start + index)),
    );
  }
  const view = await renderApp();
  await click(view.container, "Review");
  await waitForCondition(() => buttonsNamed(view.container, "Show answer").length === 1);
  return view;
}

const prompt = (container: HTMLElement) => container.querySelector<HTMLElement>("p[tabindex='-1']")!;

// Dispatches a keydown on the focused element, as a key press inside the card would.
async function press(key: string, init: KeyboardEventInit = {}, target: Element | null = document.activeElement) {
  await act(async () => {
    target?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  });
}

async function focusPrompt(container: HTMLElement) {
  await act(async () => {
    prompt(container).focus();
  });
}

// A rating has settled once focus is back on the prompt, which it moves to after the save and the practice write.
const settledOn = (container: HTMLElement, text: string) => () =>
  hasText(container, text)() && document.activeElement === prompt(container);

// Clicks a rating once a previous rating's save has finished and re-enabled it.
async function rate(container: HTMLElement, grade: string) {
  await waitForCondition(() => buttonsNamed(container, grade)[0]?.disabled === false);
  await click(container, grade);
}

// The key hints drawn beside a button.
const kbdKeys = (button: HTMLElement | undefined) =>
  Array.from(button?.parentElement?.querySelectorAll("kbd") ?? []).map((kbd) => kbd.textContent);

const repsOf = async (front: string) => (await getAllCards()).find((card: VocabCard) => card.front === front)?.fsrs.reps;

describe("ReviewDeck", () => {
  afterEach(async () => {
    await resetApp();
    vi.useRealTimers();
  });

  it("shows the no-cards empty state and Go to library switches the view", async () => {
    const { container } = await renderApp();
    await click(container, "Review");
    await waitForCondition(
      hasText(container, "Nothing to review yet. Save a sentence or a word from a lesson to build your deck."),
    );
    await click(container, "Go to library");
    expect(container.querySelector("h1")?.textContent).toBe("Lesson library");
    await waitForCondition(hasText(container, "Greetings & Basics"));
  });

  it("shows All caught up when cards exist but none are due", async () => {
    const card = createCard({ front: "f", back: "b", source: { lessonId: "l", sentenceId: "s", word: "" } }, new Date());
    await putCard({ ...card, fsrs: { ...card.fsrs, due: new Date(Date.now() + 86_400_000), state: State.Review } });
    const { container } = await renderApp();
    await click(container, "Review");
    await waitForCondition(hasText(container, "All caught up. Come back later for your next review."));
    const line = Array.from(container.querySelectorAll("p")).find((p) => p.textContent?.startsWith("All caught up"));
    expect(line?.tabIndex).toBe(-1);
    expect(buttonsNamed(container, "Go to library")).toHaveLength(1);
    expect(container.textContent).not.toContain("Reviewed");
    expect(container.textContent).not.toContain("Rated Again");
  });

  it("says how many new cards the daily cap hides", async () => {
    for (let index = 0; index < 3; index += 1) {
      await putCard(
        createCard({ front: `f${index}`, back: "b", source: { lessonId: "l", sentenceId: `s${index}`, word: "" } }, new Date()),
      );
    }
    for (let index = 0; index < 20; index += 1) {
      await recordPractice(todayKey(new Date()), { newCard: true });
    }
    const { container } = await renderApp();
    await click(container, "Review");
    await waitForCondition(hasText(container, "Daily limit of 20 new cards reached. 3 new cards are waiting."));
    expect(container.textContent).toContain("0 due");
  });

  it("shows each grade's next interval, named after the grade word, with its key hint", async () => {
    const { container } = await openReview("one");
    expect(kbdKeys(buttonsNamed(container, "Show answer")[0])).toEqual(["SPACE"]);
    await click(container, "Show answer");

    const expected = { Again: ["1 min", "1"], Hard: ["6 min", "2"], Good: ["10 min", "3"], Easy: ["8 d", "4"] };
    for (const [grade, [interval, key]] of Object.entries(expected)) {
      const button = buttonsNamed(container, grade)[0]!;
      const description = document.getElementById(button.getAttribute("aria-describedby") ?? "");
      expect(description?.textContent).toBe(interval);
      expect(button.getAttribute("aria-keyshortcuts")).toBe(key);
      expect(kbdKeys(button)).toEqual([key]);
    }
  });

  it("reveals with Space or Enter and rates with 1-4 only while focus is in the card", async () => {
    const { container } = await openReview("one", "two", "three");

    await press(" ", {}, document.body);
    expect(buttonsNamed(container, "Show answer")).toHaveLength(1);

    await focusPrompt(container);
    await press("3");
    expect(buttonsNamed(container, "Good")).toHaveLength(0);
    await press(" ", { ctrlKey: true });
    await press(" ", { shiftKey: true });
    expect(buttonsNamed(container, "Show answer")).toHaveLength(1);
    await press(" ", {}, buttonsNamed(container, "Show answer")[0]!);
    expect(buttonsNamed(container, "Show answer")).toHaveLength(1);

    await press(" ");
    expect(buttonsNamed(container, "Good")).toHaveLength(1);
    expect(document.activeElement?.textContent).toBe("one back");

    await press("3", { altKey: true });
    await press("3", { metaKey: true });
    await press("3", { repeat: true });
    expect(await repsOf("one")).toBe(0);

    await press("3");
    await waitForCondition(settledOn(container, "two"));
    expect(await repsOf("one")).toBe(1);
    expect(document.activeElement).toBe(prompt(container));
    expect(buttonsNamed(container, "Show answer")).toHaveLength(1);

    await press("Enter");
    expect(buttonsNamed(container, "Easy")).toHaveLength(1);
    await press("4");
    await waitForCondition(settledOn(container, "three"));
    expect(await repsOf("two")).toBe(1);
  });

  it("rates and replays with a card button focused, but leaves Space and Enter to the button", async () => {
    const speech = installSpeechFakes();
    const { container } = await openReview("one", "two");
    const saveReview = vi.spyOn(vocabStore, "saveReview");

    const listen = buttonsNamed(container, "Listen")[0]!;
    await act(async () => {
      listen.focus();
    });
    await press("r");
    expect(speech.spoken.map((utterance) => utterance.text)).toEqual(["one"]);
    await press(" ");
    await press("Enter");
    expect(buttonsNamed(container, "Show answer")).toHaveLength(1);

    await click(container, "Show answer");
    const good = buttonsNamed(container, "Good")[0]!;
    await act(async () => {
      good.focus();
    });
    await press("1");
    await waitForCondition(settledOn(container, "two"));
    expect(saveReview).toHaveBeenCalledTimes(1);
    expect(saveReview.mock.calls[0]?.[1]).toBe(Rating.Again);
    expect(await repsOf("one")).toBe(1);
  });

  it("ignores rating keys and hides their hints while a rating is in flight", async () => {
    const { container } = await openReview("one", "two");
    const gate = deferred<void>();
    const saveReview = vocabStore.saveReview;
    const spy = vi.spyOn(vocabStore, "saveReview").mockImplementationOnce(async (...args) => {
      await gate.promise;
      return saveReview(...args);
    });
    await focusPrompt(container);
    await press(" ");
    await press("1");
    await press("2");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(buttonsNamed(container, "Again")[0]?.disabled).toBe(true);
    expect(kbdKeys(buttonsNamed(container, "Again")[0])).toEqual([]);
    expect(kbdKeys(buttonsNamed(container, "Easy")[0])).toEqual([]);

    await act(async () => {
      gate.resolve();
    });
    await waitForCondition(settledOn(container, "two"));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("recaps the saved ratings per grade and the cards rated Again, and not a failed or stale rating", async () => {
    const speech = installSpeechFakes();
    const { container } = await openReview("one", "two", "three");

    await click(container, "Show answer");
    await rate(container, "Good");
    await waitForCondition(settledOn(container, "two"));

    await click(container, "Show answer");
    vi.spyOn(vocabStore, "saveReview").mockRejectedValueOnce(new Error("quota"));
    await rate(container, "Hard");
    await waitForCondition(settledOn(container, "Couldn't save. Try again."));
    await rate(container, "Again");
    await waitForCondition(settledOn(container, "three"));

    await click(container, "Show answer");
    const [stored] = (await getAllCards()).filter((card) => card.front === "three");
    await putCard({ ...stored!, updatedAt: new Date(Date.now() + 1_000).toISOString() });
    await rate(container, "Easy");
    await waitForCondition(settledOn(container, "This card changed on another device."));
    await click(container, "Show answer");
    await rate(container, "Easy");

    await waitForCondition(settledOn(container, "Reviewed"));
    const line = prompt(container);
    expect(document.activeElement).toBe(line);
    expect(line.textContent).toBe("Reviewed 3 cards: 1 Again, 1 Good, 1 Easy. All caught up. Next card in 1 min.");

    const list = container.querySelector("ul");
    expect(document.getElementById(list?.getAttribute("aria-labelledby") ?? "")?.textContent).toBe("Rated Again");
    expect(Array.from(list?.querySelectorAll("li") ?? []).map((item) => item.textContent)).toEqual(["twoListen"]);

    const listen = buttonsNamed(container, "Listen")[0]!;
    expect(listen.getAttribute("aria-label")).toBe("Listen to two");
    await click(container, "Listen");
    expect(speech.spoken.at(-1)?.text).toBe("two");
  });

  it("lists a card rated Again twice once", async () => {
    const { container } = await openReview("one");
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], shouldAdvanceTime: true });
    await click(container, "Show answer");
    await rate(container, "Again");
    await waitForCondition(settledOn(container, "Reviewed 1 card: 1 Again. All caught up. Next card in 1 min."));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    await waitForCondition(() => buttonsNamed(container, "Show answer").length === 1);
    await click(container, "Show answer");
    await rate(container, "Again");

    await waitForCondition(hasText(container, "Reviewed 2 cards: 2 Again."));
    expect(Array.from(container.querySelectorAll("li")).map((item) => item.textContent)).toEqual(["one"]);
    expect(buttonsNamed(container, "Listen")).toHaveLength(0);
  });

  it("drops the recap on leaving the review view", async () => {
    const { container } = await openReview("one");
    await click(container, "Show answer");
    await rate(container, "Good");
    await waitForCondition(hasText(container, "Reviewed 1 card: 1 Good. All caught up."));
    expect(container.textContent).not.toContain("Rated Again");

    await click(container, "Library");
    await click(container, "Review");
    await waitForCondition(hasText(container, "All caught up."));
    expect(container.textContent).not.toContain("Reviewed");
  });

  it("speaks the card front on Listen or R, and stops on rating, on the next card and on unmount", async () => {
    const speech = installSpeechFakes();
    const { container, unmount } = await openReview("one", "two");

    expect(kbdKeys(buttonsNamed(container, "Listen")[0])).toEqual(["R"]);
    await click(container, "Listen");
    expect(speech.spoken.map((utterance) => [utterance.text, (utterance as unknown as { lang: string }).lang])).toEqual([
      ["one", "en-US"],
    ]);
    await focusPrompt(container);
    await press("r");
    await press("R", { shiftKey: true });
    expect(speech.spoken.map((utterance) => utterance.text)).toEqual(["one", "one"]);

    await click(container, "Show answer");
    speech.cancel.mockClear();
    await rate(container, "Good");
    await waitForCondition(settledOn(container, "two"));
    expect(speech.cancel).toHaveBeenCalled();

    await click(container, "Listen");
    speech.cancel.mockClear();
    await unmount();
    expect(speech.cancel).toHaveBeenCalled();
  });

  it("has no Listen button or R hint without speech synthesis", async () => {
    removeBrowserGlobals();
    const { container } = await openReview("one");
    expect(buttonsNamed(container, "Listen")).toHaveLength(0);
    await focusPrompt(container);
    await press("r");
    await click(container, "Show answer");
    await rate(container, "Again");
    await waitForCondition(hasText(container, "Rated Again"));
    expect(buttonsNamed(container, "Listen")).toHaveLength(0);
  });
});
