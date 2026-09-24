import { afterEach, describe, expect, it, vi } from "vitest";

import * as progressStore from "../lib/progressStore";
import { getCompletedLessons } from "../lib/progressStore";
import { putUserLesson } from "../lib/userLessons";
import { createCard, wordCard } from "../lib/vocab";
import * as vocabStore from "../lib/vocabStore";
import { getAllCards, putCard } from "../lib/vocabStore";
import {
  buttonsNamed,
  click,
  clickButtonWith,
  h1Texts,
  hasText,
  harnessAct,
  openLesson,
  renderApp,
  reopenGreetings,
  resetApp,
  submitInput,
  waitForCondition,
} from "../test/app";
import type { Lesson } from "../api/lessons";
import { installSpeechFakes } from "../test/browser";
import { deferred, greetingsLesson, userLesson } from "../test/fixtures";

const [first, second, third] = greetingsLesson.sentences;

const summary = (container: HTMLElement) =>
  Array.from(container.querySelectorAll("h2")).find((heading) => heading.textContent === "Lesson complete")?.closest("section") ?? null;

const completionStatus = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[role="status"]')).filter((region) => region.textContent === "Lesson complete.");

async function answer(container: HTMLElement, kind: "dictation" | "blank", sentenceId: string, value = "anything") {
  await click(container, kind === "dictation" ? "Dictation" : "Fill the blank");
  const input = container.querySelector<HTMLInputElement>(`#${kind}-${sentenceId}`);
  if (!input) throw new Error(`${kind} input for ${sentenceId} not found`);
  await submitInput(input, value);
}

// Opens Greetings & Basics and waits for it to show.
async function openGreetings() {
  installSpeechFakes();
  const view = await openLesson();
  await waitForCondition(() => h1Texts(view.container)[0] === "Greetings & Basics");
  return view;
}

// Lets queued saves and reloads settle.
async function settle() {
  for (let index = 0; index < 5; index += 1) {
    await harnessAct(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe("lesson summary", () => {
  afterEach(async () => {
    await resetApp();
    localStorage.clear();
  });

  it("completes the lesson once when every sentence is attempted, mixing modes", async () => {
    const save = vi.spyOn(progressStore, "markLessonComplete");
    const { container } = await openGreetings();
    await answer(container, "dictation", first.id);
    await answer(container, "blank", second.id);
    expect(summary(container)).toBeNull();
    await answer(container, "blank", third.id);

    await waitForCondition(() => buttonsNamed(container, "Back to lessons").length === 2);
    await waitForCondition(hasText(container, "Completed"));
    expect(summary(container)?.textContent).toContain("You practised all 3 sentences.");
    await answer(container, "dictation", second.id);
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith(greetingsLesson.id);
    expect(await getCompletedLessons()).toEqual([greetingsLesson.id]);
  });

  it("does not complete the lesson when one sentence is not attempted", async () => {
    const save = vi.spyOn(progressStore, "markLessonComplete");
    const { container } = await openGreetings();
    await answer(container, "dictation", first.id);
    await answer(container, "dictation", second.id);
    await answer(container, "blank", first.id);
    await settle();
    expect(summary(container)).toBeNull();
    expect(save).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Completed");
  });

  it("does not count Listen or Loop as an attempt", async () => {
    const save = vi.spyOn(progressStore, "markLessonComplete");
    const { container } = await openGreetings();
    for (let index = 0; index < 3; index += 1) {
      await click(container, "Listen", index);
      await click(container, "Loop", index);
      await click(container, "Loop", index);
    }
    await settle();
    expect(summary(container)).toBeNull();
    expect(save).not.toHaveBeenCalled();
  });

  it("does not save an already complete lesson again but shows the summary", async () => {
    await progressStore.markLessonComplete(greetingsLesson.id);
    const save = vi.spyOn(progressStore, "markLessonComplete");
    const { container } = await openGreetings();
    await waitForCondition(hasText(container, "Completed"));
    for (const sentence of greetingsLesson.sentences) {
      await answer(container, "dictation", sentence.id);
    }
    await settle();
    expect(summary(container)).not.toBeNull();
    expect(completionStatus(container)).toHaveLength(1);
    expect(save).not.toHaveBeenCalled();
  });

  it("announces completion only after the save succeeds: nothing while saving, only the failure, then Try again", async () => {
    const gate = deferred<void>();
    const save = vi.spyOn(progressStore, "markLessonComplete").mockImplementationOnce(async () => {
      await gate.promise;
      throw new Error("quota");
    });
    const { container } = await openGreetings();
    for (const sentence of greetingsLesson.sentences) {
      await answer(container, "dictation", sentence.id);
    }
    await waitForCondition(() => summary(container) !== null);
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(completionStatus(container)).toHaveLength(0);

    await harnessAct(async () => {
      gate.resolve();
    });
    await waitForCondition(hasText(container, "Couldn't save your progress."));
    await settle();
    expect(completionStatus(container)).toHaveLength(0);

    await click(summary(container)!, "Try again");
    await waitForCondition(hasText(container, "Completed"));
    expect(completionStatus(container)).toHaveLength(1);
  });

  it("shows an Alert when the save fails and Try again retries it", async () => {
    const save = vi.spyOn(progressStore, "markLessonComplete").mockRejectedValueOnce(new Error("quota"));
    const { container } = await openGreetings();
    for (const sentence of greetingsLesson.sentences) {
      await answer(container, "dictation", sentence.id);
    }
    await waitForCondition(hasText(container, "Couldn't save your progress."));
    const section = summary(container)!;
    expect(section.querySelector('[role="alert"]')?.textContent).toBe("Couldn't save your progress.");
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(container.textContent).not.toContain("Completed");

    await click(section, "Try again");
    await waitForCondition(hasText(container, "Completed"));
    expect(save).toHaveBeenCalledTimes(2);
    expect(container.textContent).not.toContain("Couldn't save your progress.");
    // Try again is gone, so focus moves to the summary heading.
    expect(document.activeElement?.textContent).toBe("Lesson complete");
    expect(await getCompletedLessons()).toEqual([greetingsLesson.id]);
  });

  it("shows the count, the cards due with Review now, the next library lesson and Back to lessons", async () => {
    for (const sentenceId of ["a", "b"]) {
      await putCard(createCard({ front: sentenceId, back: "x", source: { lessonId: "lesson-1", sentenceId, word: "" } }, new Date()));
    }
    const { container } = await openGreetings();
    for (const sentence of greetingsLesson.sentences) {
      await answer(container, "dictation", sentence.id);
    }
    await waitForCondition(() => summary(container)?.textContent?.includes("Next lesson: Daily Routine") ?? false);
    const section = summary(container)!;
    expect(section.textContent).toContain("You practised all 3 sentences.");
    expect(section.textContent).toContain("2 cards due now.");

    await click(section, "Next lesson: Daily Routine");
    await waitForCondition(() => h1Texts(container)[0] === "Greetings & Basics" && summary(container) === null);
    expect(window.location.hash).toBe("#/lesson/daily-routine");
    await click(container, "Back to lessons");
    await reopenGreetings(container);
    for (const sentence of greetingsLesson.sentences) {
      await answer(container, "dictation", sentence.id);
    }
    await click(summary(container)!, "Review now");
    await waitForCondition(() => h1Texts(container)[0] === "Review deck");

    await click(container, "Library");
    await reopenGreetings(container);
    for (const sentence of greetingsLesson.sentences) {
      await answer(container, "dictation", sentence.id);
    }
    await click(summary(container)!, "Back to lessons");
    await waitForCondition(() => h1Texts(container)[0] === "Lesson library");
  });

  it("hides Review now with no cards due and the next lesson after the last one in the level", async () => {
    localStorage.setItem("road-to-english.levelFilter", "A2");
    const { container } = await openGreetings();
    for (const sentence of greetingsLesson.sentences) {
      await answer(container, "dictation", sentence.id);
    }
    await waitForCondition(() => summary(container) !== null);
    await settle();
    const section = summary(container)!;
    expect(section.textContent).not.toContain("due now");
    expect(buttonsNamed(section, "Review now")).toHaveLength(0);
    expect(section.textContent).not.toContain("Next lesson");
    expect(buttonsNamed(section, "Back to lessons")).toHaveLength(1);
  });

  it("hides Review now while the due count is unknown", async () => {
    vi.spyOn(vocabStore, "getAllCards").mockRejectedValue(new Error("blocked"));
    const { container } = await openGreetings();
    for (const sentence of greetingsLesson.sentences) {
      await answer(container, "dictation", sentence.id);
    }
    await waitForCondition(() => summary(container) !== null);
    expect(summary(container)!.textContent).not.toContain("due now");
    expect(buttonsNamed(summary(container)!, "Review now")).toHaveLength(0);
  });

  it("offers the next of your own lessons, and none after the last", async () => {
    const later = { ...userLesson, id: "user-00000000-0000-4000-8000-000000000002", title: "Later text" };
    await putUserLesson(userLesson);
    await putUserLesson(later);
    installSpeechFakes();
    const { container } = await renderApp();
    await waitForCondition(hasText(container, userLesson.title));
    await clickButtonWith(container, userLesson.title);
    await waitForCondition(() => h1Texts(container)[0] === userLesson.title);
    for (const sentence of userLesson.sentences) {
      await answer(container, "dictation", sentence.id);
    }
    await waitForCondition(() => summary(container) !== null);
    expect(summary(container)!.textContent).toContain("You practised all 2 sentences.");

    await click(summary(container)!, "Next lesson: Later text");
    await waitForCondition(() => h1Texts(container)[0] === "Later text");
    for (const sentence of later.sentences) {
      await answer(container, "dictation", sentence.id);
    }
    await waitForCondition(() => summary(container) !== null);
    expect(summary(container)!.textContent).not.toContain("Next lesson");
  });

  it("announces completion once and does not move focus", async () => {
    const { container } = await openGreetings();
    await answer(container, "dictation", first.id);
    await answer(container, "dictation", second.id);
    const input = container.querySelector<HTMLInputElement>(`#dictation-${third.id}`)!;
    input.focus();
    expect(completionStatus(container)).toHaveLength(0);
    await submitInput(input, "anything");
    await waitForCondition(() => completionStatus(container).length === 1);
    expect(document.activeElement).toBe(input);
    expect(summary(container)!.contains(document.activeElement)).toBe(false);

    await answer(container, "blank", first.id);
    await settle();
    expect(completionStatus(container)).toHaveLength(1);
  });

  it("starts attempts afresh on a new visit and keeps the saved completion", async () => {
    const { container } = await openGreetings();
    for (const sentence of greetingsLesson.sentences) {
      await answer(container, "dictation", sentence.id);
    }
    await waitForCondition(hasText(container, "Completed"));
    await click(container, "Back to lessons");
    await waitForCondition(() => {
      const row = Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Greetings & Basics"));
      return row?.textContent?.includes("Completed") ?? false;
    });

    await reopenGreetings(container);
    await waitForCondition(() => h1Texts(container)[0] === "Greetings & Basics");
    expect(container.textContent).toContain("Completed");
    expect(summary(container)).toBeNull();
    await answer(container, "dictation", first.id);
    expect(summary(container)).toBeNull();
  });
});

describe("missed words", () => {
  afterEach(async () => {
    await resetApp();
    localStorage.clear();
  });

  const missedList = (container: HTMLElement) => summary(container)?.querySelector('ul[aria-labelledby="missed-words"]') ?? null;
  // Each item's save button names its word: Save “went” to review.
  const missedWords = (container: HTMLElement) =>
    Array.from(missedList(container)?.querySelectorAll("li button") ?? []).map(
      (button) => /“(.+)”/.exec(button.getAttribute("aria-label") ?? "")?.[1],
    );
  const saveButton = (container: HTMLElement, word: string) => {
    const button = Array.from(missedList(container)?.querySelectorAll("li button") ?? []).find((candidate) =>
      candidate.getAttribute("aria-label")?.includes(`“${word}”`),
    );
    if (!(button instanceof HTMLButtonElement)) throw new Error(`save button for ${word} not found`);
    return button;
  };
  const saveWord = (container: HTMLElement, word: string) => click(saveButton(container, word).closest("li")!, "Save");
  // The stored cards' content, to compare exactly with wordCard().
  const storedCards = async () => (await getAllCards()).map(({ front, back, source }) => ({ front, back, source }));

  it("lists dictation's missed and replaced words in first-occurrence order, once each across sentences and tries", async () => {
    const lesson = {
      ...greetingsLesson,
      sentences: [
        { id: "s1", text: "I went to the park today.", vi: "" },
        { id: "s2", text: "We went home.", vi: "" },
      ],
    } satisfies Lesson;
    installSpeechFakes();
    const { container } = await openLesson(lesson);
    await waitForCondition(() => h1Texts(container)[0] === "Greetings & Basics");
    await answer(container, "dictation", "s1", "I go to the park");
    await click(container, "Try again");
    await answer(container, "dictation", "s1", "I went to the park");
    await answer(container, "dictation", "s2", "we go");
    await waitForCondition(() => missedList(container) !== null);
    expect(missedWords(container)).toEqual(["went", "today", "home"]);
    expect(missedList(container)!.querySelectorAll("li")[0].textContent).toContain("went");
  });

  it("lists a missed hyphenated word once, with the word panel's card id", async () => {
    const lesson = {
      ...greetingsLesson,
      sentences: [{ id: "s1", text: "I bought a one-way ticket for twenty-five dollars.", vi: "" }],
    } satisfies Lesson;
    installSpeechFakes();
    const { container } = await openLesson(lesson);
    await waitForCondition(() => h1Texts(container)[0] === "Greetings & Basics");
    await answer(container, "dictation", "s1", "I bought a way ticket for twenty dollars");
    await waitForCondition(() => missedList(container) !== null);
    expect(missedWords(container)).toEqual(["one-way", "twenty-five"]);

    for (const word of ["one-way", "twenty-five"]) {
      await saveWord(container, word);
      await waitForCondition(() => saveButton(container, word).getAttribute("aria-label") === `Saved “${word}”, remove from review deck`);
    }
    await click(container, "Shadow");
    for (const word of ["one-way", "twenty-five"]) {
      await click(container, word);
      expect(buttonsNamed(container, "Saved")).toHaveLength(3);
    }
    expect(await storedCards()).toEqual([
      wordCard(lesson.id, lesson.sentences[0], "one-way"),
      wordCard(lesson.id, lesson.sentences[0], "twenty-five"),
    ]);
  });

  it("never lists a word the word panel does not offer", async () => {
    const lesson = {
      ...greetingsLesson,
      sentences: [{ id: "s1", text: "A naïve plan, e.g. this one.", vi: "" }],
    } satisfies Lesson;
    installSpeechFakes();
    const { container } = await openLesson(lesson);
    await waitForCondition(() => h1Texts(container)[0] === "Greetings & Basics");
    // The panel offers "na", "ve", "e" and "g" but never "naïve" or "e.g"; the diff misses those whole words.
    await answer(container, "dictation", "s1", "a plan this");
    await waitForCondition(() => missedList(container) !== null);
    expect(missedWords(container)).toEqual(["one"]);
  });

  it("lists nothing for an empty or whitespace-only dictation check", async () => {
    const { container } = await openGreetings();
    await answer(container, "dictation", first.id, "");
    await answer(container, "dictation", first.id, "   ");
    await answer(container, "dictation", first.id, first.text);
    await answer(container, "dictation", second.id, second.text);
    await answer(container, "dictation", third.id, "see you");
    await waitForCondition(() => missedList(container) !== null);
    expect(missedWords(container)).toEqual(["tomorrow"]);
  });

  it("lists a wrong fill-the-blank word, never a right answer or an empty check", async () => {
    const { container } = await openGreetings();
    await answer(container, "blank", first.id, "");
    await answer(container, "blank", first.id, "morning");
    await answer(container, "blank", second.id, "nice");
    await answer(container, "blank", third.id, "today");
    await waitForCondition(() => missedList(container) !== null);
    await click(container, "Try again", 0);
    await answer(container, "blank", first.id, "evening");
    await settle();
    expect(missedWords(container)).toEqual(["tomorrow", "morning"]);
  });

  it("never lists an extra typed token or a pronunciation-check result", async () => {
    class FakeRecognition {
      static instances: FakeRecognition[] = [];
      lang = "";
      continuous = true;
      interimResults = true;
      maxAlternatives = 5;
      processLocally = false;
      onresult: ((event: { results: { transcript: string }[][] }) => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      start = vi.fn();
      abort = vi.fn();
      constructor() {
        FakeRecognition.instances.push(this);
      }
    }
    vi.stubGlobal("webkitSpeechRecognition", FakeRecognition);
    const { container } = await openGreetings();
    await click(container, "Pronunciation check");
    await click(container, "Enable");
    await click(container, "Check pronunciation");
    const recognition = FakeRecognition.instances.at(-1)!;
    await harnessAct(async () => {
      recognition.onresult?.({ results: [[{ transcript: "good evening how are you" }]] });
      recognition.onend?.();
    });
    await answer(container, "dictation", first.id, "good morning how are you today friend");
    await answer(container, "dictation", second.id, "it is nice to meet you");
    await answer(container, "dictation", third.id, "see you");
    await waitForCondition(() => missedList(container) !== null);
    expect(missedWords(container)).toEqual(["tomorrow"]);
  });

  it("keeps exactly the word panel's card whichever control saves it, and both show it saved", async () => {
    const { container } = await openGreetings();
    await answer(container, "dictation", first.id, "morning how are you today");
    await answer(container, "dictation", second.id, "is nice to meet you");
    await answer(container, "dictation", third.id, "see you tomorrow");
    await waitForCondition(() => missedList(container) !== null);
    expect(missedWords(container)).toEqual(["Good", "It"]);

    // Summary first, then the word panel.
    await saveWord(container, "Good");
    await waitForCondition(() => saveButton(container, "Good").getAttribute("aria-label") === "Saved “Good”, remove from review deck");
    expect(await storedCards()).toEqual([wordCard(greetingsLesson.id, first, "Good")]);
    await click(container, "Shadow");
    await click(container, "Good");
    expect(buttonsNamed(container, "Saved")).toHaveLength(2);
    expect(await storedCards()).toEqual([wordCard(greetingsLesson.id, first, "Good")]);

    // The word panel first, then the summary.
    await click(container, "It");
    await click(container, "Save word");
    await waitForCondition(() => saveButton(container, "It").getAttribute("aria-label") === "Saved “It”, remove from review deck");
    expect(await storedCards()).toEqual([
      wordCard(greetingsLesson.id, first, "Good"),
      wordCard(greetingsLesson.id, second, "It"),
    ]);
  });

  it("names each save button's word in both states", async () => {
    const { container } = await openGreetings();
    await answer(container, "dictation", first.id, "good evening how are you today");
    await answer(container, "dictation", second.id, "it is nice to meet");
    await answer(container, "dictation", third.id, "see you tomorrow");
    await waitForCondition(() => missedList(container) !== null);
    expect(saveButton(container, "morning").getAttribute("aria-label")).toBe("Save “morning” to review");
    expect(saveButton(container, "you").getAttribute("aria-label")).toBe("Save “you” to review");
    expect(summary(container)!.querySelector("#missed-words")?.textContent).toBe("Missed words");
    await saveWord(container, "you");
    await waitForCondition(() => saveButton(container, "you").getAttribute("aria-label") === "Saved “you”, remove from review deck");
    expect(saveButton(container, "morning").getAttribute("aria-label")).toBe("Save “morning” to review");
  });

  it("shows no Missed words section when nothing was missed", async () => {
    const { container } = await openGreetings();
    for (const sentence of greetingsLesson.sentences) {
      await answer(container, "dictation", sentence.id, sentence.text);
    }
    await waitForCondition(() => summary(container) !== null);
    await settle();
    expect(summary(container)!.textContent).not.toContain("Missed words");
    expect(missedList(container)).toBeNull();
  });

  it("starts the list afresh on a new visit", async () => {
    const { container } = await openGreetings();
    for (const sentence of greetingsLesson.sentences) {
      await answer(container, "dictation", sentence.id, "anything");
    }
    await waitForCondition(() => missedList(container) !== null);
    await click(container, "Back to lessons");
    await reopenGreetings(container);
    await waitForCondition(() => h1Texts(container)[0] === "Greetings & Basics" && summary(container) === null);
    await answer(container, "dictation", first.id, first.text);
    await answer(container, "dictation", second.id, second.text);
    await answer(container, "dictation", third.id, "see you");
    await waitForCondition(() => missedList(container) !== null);
    expect(missedWords(container)).toEqual(["tomorrow"]);
  });
});
