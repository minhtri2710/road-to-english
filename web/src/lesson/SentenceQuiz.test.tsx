import { afterEach, describe, expect, it, vi } from "vitest";

import type { Lesson } from "../api/lessons";
import {
  actionsToday,
  buttonsNamed,
  click,
  clickButtonWith,
  clickElement,
  harnessAct,
  openLesson,
  resetApp,
  setInputValue,
  submitInput,
} from "../test/app";
import { installSpeechFakes, removeBrowserGlobals } from "../test/browser";
import { greetingsLesson } from "../test/fixtures";

const hearButton = (container: HTMLElement, word: string) =>
  container.querySelector<HTMLButtonElement>(`button[aria-label="Hear ${word}"]`);

async function submitDictation(container: HTMLElement, sentenceId: string, value: string) {
  const input = container.querySelector<HTMLInputElement>(`#dictation-${sentenceId}`);
  if (!input) throw new Error("dictation input not found");
  await submitInput(input, value);
  return input;
}

describe("SentenceQuiz", () => {
  afterEach(resetApp);

  it("keeps dictation references hidden until checking and reveals the result", async () => {
    vi.stubGlobal("speechSynthesis", { speak: vi.fn(), cancel: vi.fn() });
    vi.stubGlobal("SpeechSynthesisUtterance", class {});
    const { container } = await openLesson();
    const sentence = greetingsLesson.sentences[0];

    await clickButtonWith(container, "Dictation");

    expect(container.textContent).not.toContain(sentence.text);
    expect(container.textContent).not.toContain("casual sign-off");

    const input = container.querySelector<HTMLInputElement>(
      `#dictation-${sentence.id}`,
    );
    // The visible label names the input (WCAG 2.5.3 label in name), so no aria-label overrides it.
    expect(input?.hasAttribute("aria-label")).toBe(false);
    expect(container.querySelector(`label[for="dictation-${sentence.id}"]`)?.textContent).toBe("What did you hear?");

    await harnessAct(async () => {
      if (!input) throw new Error("dictation input not found");
      setInputValue(input, sentence.text);
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      input.form!.requestSubmit();
    });

    expect(container.textContent).toContain(`Reference: ${sentence.text}`);
    expect(container.textContent).toContain("Correct");
    expect(container.textContent).not.toMatch(/\((missed|extra|you typed)/);

    await clickButtonWith(container, "Try again");
    expect(container.textContent).not.toContain(sentence.text);
    expect(input?.value).toBe("");
  });

  it("marks missed and wrong words after checking dictation", async () => {
    vi.stubGlobal("speechSynthesis", { speak: vi.fn(), cancel: vi.fn() });
    vi.stubGlobal("SpeechSynthesisUtterance", class {});
    const { container } = await openLesson();

    await clickButtonWith(container, "Dictation");

    const input = container.querySelector<HTMLInputElement>(
      `#dictation-${greetingsLesson.sentences[0].id}`,
    );
    if (!input) throw new Error("dictation input not found");
    await submitInput(input, "Good, how are you tomorrow?");

    expect(container.textContent).toContain(
      'Good morning (missed) how are you today (you typed "tomorrow")',
    );
    expect(container.textContent).not.toContain("(extra)");
    expect(container.textContent).toContain("Not quite");
  });

  it("plays dictation and shows positive and negative results", async () => {
    const speak = vi.fn();
    const cancel = vi.fn();
    class FakeUtterance {
      lang = "";
      rate = 1;
      constructor(readonly text: string) {}
    }
    vi.stubGlobal("speechSynthesis", { speak, cancel });
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    const { container } = await openLesson();

    await clickButtonWith(container, "Dictation");

    await clickButtonWith(container, "Play");
    expect(speak).toHaveBeenCalledWith(expect.objectContaining({
      text: greetingsLesson.sentences[0].text,
      rate: greetingsLesson.targetWpm / 180,
      lang: "en-US",
    }));

    const input = container.querySelector<HTMLInputElement>(
      `#dictation-${greetingsLesson.sentences[0].id}`,
    );
    if (!input) throw new Error("dictation input not found");
    await submitInput(input, "wrong answer");
    expect(container.textContent).toContain("Not quite");
    expect(container.textContent).toContain(
      `Reference: ${greetingsLesson.sentences[0].text}`,
    );

    await clickButtonWith(container, "Try again");
    const retryInput = container.querySelector<HTMLInputElement>(
      `#dictation-${greetingsLesson.sentences[1].id}`,
    );
    if (!retryInput) throw new Error("second dictation input not found");
    await submitInput(retryInput, greetingsLesson.sentences[1].text);
    expect(container.textContent).toContain("Correct");
  });

  it("leads the result with a word count and drops the typed line", async () => {
    installSpeechFakes();
    const { container } = await openLesson();
    await click(container, "Dictation");
    const [first, second] = greetingsLesson.sentences;

    await submitDictation(container, first.id, "Good, how are you tomorrow?");
    const result = container.querySelector('[role="status"] p');
    expect(result?.textContent).toBe("Not quite: 4 of 6 words matched");
    expect(container.textContent).not.toContain("You typed:");
    expect(container.textContent).toContain(`Reference: ${first.text}`);

    await submitDictation(container, second.id, second.text);
    expect(container.textContent).toContain("Correct: 6 of 6 words");
  });

  it("speaks a missed or replaced word from the diff after stopping other media", async () => {
    const speech = installSpeechFakes();
    const { container } = await openLesson();
    await click(container, "Dictation");
    await submitDictation(container, greetingsLesson.sentences[0].id, "Good, how are you tomorrow?");

    expect(hearButton(container, "morning")?.textContent).toBe("morning");
    expect(hearButton(container, "good")).toBeNull();
    expect(container.textContent).toContain('today (you typed "tomorrow")');
    speech.cancel.mockClear();
    await clickElement(hearButton(container, "today"), "today hear button");
    expect(speech.cancel).toHaveBeenCalled();
    expect(speech.spoken.at(-1)).toMatchObject({ text: "today", rate: greetingsLesson.targetWpm / 180 });
  });

  it("keeps diff words as labelled text when speech is unsupported", async () => {
    removeBrowserGlobals();
    const { container } = await openLesson();
    await click(container, "Dictation");
    await submitDictation(container, greetingsLesson.sentences[0].id, "Good, how are you tomorrow?");
    expect(hearButton(container, "morning")).toBeNull();
    expect(container.textContent).toContain("morning (missed)");
  });

  it("shows a first-letter hint that resets on Try again and counts no practice", async () => {
    installSpeechFakes();
    const { container } = await openLesson();
    expect(await actionsToday()).toBe(0);
    await click(container, "Dictation");
    const hint = "G___ m______, h__ a__ y__ t____?";
    expect(container.textContent).not.toContain(hint);

    const toggle = buttonsNamed(container, "Show hint")[0]!;
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await click(container, "Show hint");
    expect(container.textContent).toContain(hint);
    expect(buttonsNamed(container, "Show hint")).toHaveLength(2);
    expect(toggle.textContent).toBe("Hide hint");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)?.textContent).toBe(`Hint: ${hint}`);
    await harnessAct(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(await actionsToday()).toBe(0);

    await submitDictation(container, greetingsLesson.sentences[0].id, "Good morning");
    await click(container, "Try again");
    expect(container.textContent).not.toContain(hint);
    expect(buttonsNamed(container, "Show hint")).toHaveLength(3);
  });

  it("flags a dropped ending without changing the result", async () => {
    installSpeechFakes();
    const lesson = {
      ...greetingsLesson,
      sentences: [{ id: "s1", text: "She wanted two coffees.", vi: "", notes: "past tense" }],
    };
    const { container } = await openLesson(lesson);
    await click(container, "Dictation");
    await submitDictation(container, "s1", "She want two coffee");
    const lines = Array.from(container.querySelectorAll('[role="status"] p')).map((p) => p.textContent);
    expect(lines[0]).toBe("Not quite: 2 of 4 words matched");
    expect(lines.slice(-2)).toEqual(["Check the ending sound: wanted, coffees", "past tense"]);
  });

  it("names ending hints and Hear buttons with the lesson's own word", async () => {
    installSpeechFakes();
    const lesson = {
      ...greetingsLesson,
      sentences: [{ id: "s1", text: "It is John's book.", vi: "", notes: "" }],
    };
    const { container } = await openLesson(lesson);
    await click(container, "Dictation");
    await submitDictation(container, "s1", "It is John book");
    expect(hearButton(container, "John's")?.textContent).toBe("John's");
    expect(container.textContent).toContain("Check the ending sound: John's");
  });

  it("reads the blank as the word blank", async () => {
    installSpeechFakes();
    const { container } = await openLesson();
    await click(container, "Fill the blank");
    const gap = Array.from(container.querySelectorAll("[aria-hidden]")).find((node) => node.textContent === "____");
    expect(gap?.getAttribute("aria-hidden")).toBe("true");
    expect(gap?.nextElementSibling?.textContent).toBe("blank");
  });

  describe("word bank", () => {
    const a1Lesson = {
      id: "about-me",
      title: "About Me",
      level: "A1",
      targetWpm: 80,
      sentences: [
        { id: "about-me-1", text: "My name is Lan.", vi: "" },
        { id: "about-me-3", text: "I come from Vietnam.", vi: "" },
        { id: "about-me-6", text: "I like music and coffee.", vi: "" },
      ],
    } satisfies Lesson;

    const bank = (container: HTMLElement, sentenceId: string) =>
      Array.from(
        container.querySelector(`#blank-${sentenceId}`)?.closest("li")?.querySelectorAll('[role="group"] button') ?? [],
      ).map((button) => button.textContent);

    it("offers the answer and lesson words that fill the input on an A1 lesson", async () => {
      installSpeechFakes();
      const { container } = await openLesson(a1Lesson);
      expect(await actionsToday()).toBe(0);
      await click(container, "Fill the blank");

      const choices = bank(container, "about-me-1");
      expect([...choices].sort()).toEqual(["come", "from", "like", "name"]);
      expect(bank(container, "about-me-1")).toEqual(choices);

      const input = container.querySelector<HTMLInputElement>("#blank-about-me-1");
      await click(container, "name");
      expect(input?.value).toBe("name");
      expect(document.activeElement).toBe(input);
      expect(container.textContent).not.toContain("Correct");
      expect(await actionsToday()).toBe(0);

      await harnessAct(async () => {
        input!.form!.requestSubmit();
      });
      expect(container.textContent).toContain("Correct");
    });

    it("places the bank between the input and Check and shows words as written", async () => {
      installSpeechFakes();
      const { container } = await openLesson(a1Lesson);
      await click(container, "Fill the blank");
      const input = container.querySelector<HTMLInputElement>("#blank-about-me-3");
      const card = input?.closest("li");
      const group = card?.querySelector('[role="group"]');
      const check = card && buttonsNamed(card, "Check")[0];
      if (!input || !group || !check) throw new Error("blank controls not found");
      expect(input.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(group.compareDocumentPosition(check) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

      expect(bank(container, "about-me-3")).toContain("Vietnam");
      await click(card, "Vietnam");
      expect(input.value).toBe("Vietnam");
    });

    it("shows a sentence with no word to blank as plain text", async () => {
      installSpeechFakes();
      const lesson = { ...a1Lesson, sentences: [...a1Lesson.sentences, { id: "about-me-9", text: "♪♪ ...", vi: "" }] };
      const { container } = await openLesson(lesson);
      await click(container, "Fill the blank");
      const sentence = Array.from(container.querySelectorAll("p")).find((p) => p.textContent === "♪♪ ...");
      expect(sentence).toBeDefined();
      expect(container.querySelector("#blank-about-me-9")).toBeNull();
      expect(bank(container, "about-me-1").length).toBeGreaterThan(0);
    });

    it("offers no bank on other levels", async () => {
      installSpeechFakes();
      const { container } = await openLesson({ ...a1Lesson, level: "A2" });
      await click(container, "Fill the blank");
      expect(bank(container, "about-me-1")).toEqual([]);
      expect(container.textContent).not.toContain("Choose a word");
    });
  });
});
