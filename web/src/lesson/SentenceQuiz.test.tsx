import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  openLesson,
  resetApp,
  setInputValue,
} from "../test/app";
import { greetingsLesson } from "../test/fixtures";

describe("SentenceQuiz", () => {
  afterEach(resetApp);

  it("keeps dictation references hidden until checking and reveals the result", async () => {
    vi.stubGlobal("speechSynthesis", { speak: vi.fn(), cancel: vi.fn() });
    vi.stubGlobal("SpeechSynthesisUtterance", class {});
    const { container, root } = await openLesson();
    const sentence = greetingsLesson.sentences[0];

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Dictation"))
        ?.click();
    });

    expect(container.textContent).not.toContain(sentence.text);
    expect(container.textContent).not.toContain("casual sign-off");

    const input = container.querySelector<HTMLInputElement>(
      `#dictation-${sentence.id}`,
    );
    // The visible label names the input (WCAG 2.5.3 label in name), so no aria-label overrides it.
    expect(input?.hasAttribute("aria-label")).toBe(false);
    expect(container.querySelector(`label[for="dictation-${sentence.id}"]`)?.textContent).toBe("What did you hear?");

    await act(async () => {
      if (!input) throw new Error("dictation input not found");
      setInputValue(input, sentence.text);
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      input.form?.requestSubmit();
    });

    expect(container.textContent).toContain(`Reference: ${sentence.text}`);
    expect(container.textContent).toContain("Correct");
    expect(container.textContent).not.toMatch(/\((missed|extra|you typed)/);

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Try again"))
        ?.click();
    });
    expect(container.textContent).not.toContain(sentence.text);
    expect(input?.value).toBe("");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("marks missed and wrong words after checking dictation", async () => {
    vi.stubGlobal("speechSynthesis", { speak: vi.fn(), cancel: vi.fn() });
    vi.stubGlobal("SpeechSynthesisUtterance", class {});
    const { container, root } = await openLesson();

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Dictation"))
        ?.click();
    });

    const input = container.querySelector<HTMLInputElement>(
      `#dictation-${greetingsLesson.sentences[0].id}`,
    );
    if (!input) throw new Error("dictation input not found");
    await act(async () => {
      setInputValue(input, "Good, how are you tomorrow?");
      input.form?.requestSubmit();
    });

    expect(container.textContent).toContain(
      'good morning (missed) how are you today (you typed "tomorrow")',
    );
    expect(container.textContent).not.toContain("(extra)");
    expect(container.textContent).toContain("Not quite");

    await act(async () => {
      root.unmount();
    });
    container.remove();
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
    const { container, root } = await openLesson();

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Dictation"))
        ?.click();
    });

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Play"))
        ?.click();
    });
    expect(speak).toHaveBeenCalledWith(expect.objectContaining({
      text: greetingsLesson.sentences[0].text,
      rate: greetingsLesson.targetWpm / 180,
      lang: "en-US",
    }));

    const input = container.querySelector<HTMLInputElement>(
      `#dictation-${greetingsLesson.sentences[0].id}`,
    );
    if (!input) throw new Error("dictation input not found");
    await act(async () => {
      setInputValue(input, "wrong answer");
      input.form?.requestSubmit();
    });
    expect(container.textContent).toContain("Not quite");
    expect(container.textContent).toContain(
      `Reference: ${greetingsLesson.sentences[0].text}`,
    );

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Try again"))
        ?.click();
    });
    const retryInput = container.querySelector<HTMLInputElement>(
      `#dictation-${greetingsLesson.sentences[1].id}`,
    );
    if (!retryInput) throw new Error("second dictation input not found");
    await act(async () => {
      setInputValue(retryInput, greetingsLesson.sentences[1].text);
      retryInput.form?.requestSubmit();
    });
    expect(container.textContent).toContain("Correct");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
