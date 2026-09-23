import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { exportData } from "./lib/backup";
import { cardsCsv } from "./lib/csv";
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
import { greetingsLesson, lessonSummaries, userLesson } from "./test/fixtures";

const fetchMock = vi.fn<typeof fetch>();
const originalMediaDevices = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");

function responseFor(path: string, lesson = greetingsLesson): Response {
  if (path === "/me") {
    return new Response(null, { status: 401 });
  }

  if (path === "/sync") {
    return new Response(JSON.stringify({ cards: [], practiceDays: [], lessonCompletion: [] }), {
      status: 200,
    });
  }

  if (path === "/lessons") {
    return new Response(JSON.stringify(lessonSummaries), { status: 200 });
  }

  return new Response(JSON.stringify(lesson), { status: 200 });
}

function installMediaDevices(getUserMedia: () => Promise<MediaStream>): void {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
}

function installObjectUrlFakes(): { revokeObjectURL: ReturnType<typeof vi.fn> } {
  let nextUrl = 0;
  const revokeObjectURL = vi.fn();
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    value: vi.fn(() => `blob:recording-${++nextUrl}`),
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    value: revokeObjectURL,
  });
  return { revokeObjectURL };
}

async function waitForCondition(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (condition()) {
      return;
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  throw new Error("Timed out waiting for condition");
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function restoreProperty(
  target: object,
  key: string,
  descriptor: PropertyDescriptor | undefined,
): void {
  if (descriptor) {
    Object.defineProperty(target, key, descriptor);
  } else {
    delete (target as Record<string, unknown>)[key];
  }
}

function removeBrowserGlobals(): void {
  vi.stubGlobal("speechSynthesis", undefined);
  vi.stubGlobal("SpeechSynthesisUtterance", undefined);
  vi.stubGlobal("MediaRecorder", undefined);
  delete (window as unknown as Record<string, unknown>).speechSynthesis;
  delete (window as unknown as Record<string, unknown>).SpeechSynthesisUtterance;
  delete (navigator as unknown as Record<string, unknown>).mediaDevices;
}

async function reopenGreetings(container: HTMLElement): Promise<void> {
  const row = () =>
    Array.from(container.querySelectorAll("button")).find((button) => button.textContent?.includes("Greetings & Basics"));
  await waitForCondition(() => row() !== undefined);
  await act(async () => {
    row()?.click();
  });
}

async function openLesson(lesson = greetingsLesson) {
  fetchMock.mockImplementation(async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return responseFor(new URL(url, "http://localhost").pathname, lesson);
  });
  vi.stubGlobal("fetch", fetchMock);

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  await act(async () => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
  await act(async () => {
    const button = Array.from(container.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.includes("Greetings & Basics"),
    );
    button?.click();
  });

  return { container, root };
}

interface FakeSpokenUtterance {
  text: string;
  rate: number;
  onend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onboundary: ((event: { name: string; charIndex: number }) => void) | null;
}

// Models the engine: speak queues, cancel drops the queue and fires each dropped
// utterance's onend (the worst case for a stale restart), finish ends the head.
function installSpeechFakes() {
  const spoken: FakeSpokenUtterance[] = [];
  let pending: FakeSpokenUtterance[] = [];
  const speak = vi.fn((utterance: FakeSpokenUtterance) => {
    spoken.push(utterance);
    pending.push(utterance);
  });
  const cancel = vi.fn(() => {
    const dropped = pending;
    pending = [];
    dropped.forEach((utterance) => utterance.onend?.());
  });
  class FakeUtterance {
    lang = "";
    rate = 1;
    onend: (() => void) | null = null;
    onboundary: ((event: { name: string; charIndex: number }) => void) | null = null;
    constructor(readonly text: string) {}
  }
  vi.stubGlobal("speechSynthesis", { speak, cancel });
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
  const finish = () => {
    const utterance = pending.shift();
    utterance?.onend?.();
  };
  return { spoken, speak, cancel, finish };
}

function buttonsNamed(container: HTMLElement, name: string): HTMLButtonElement[] {
  // ToggleButton repeats its label in an aria-hidden width reservation span.
  return Array.from(container.querySelectorAll("button")).filter((button) => {
    const visible = button.cloneNode(true) as HTMLElement;
    visible.querySelectorAll("[aria-hidden]").forEach((node) => node.remove());
    return visible.textContent === name;
  });
}

describe("App", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    fetchMock.mockReset();
    restoreProperty(navigator, "mediaDevices", originalMediaDevices);
    restoreProperty(URL, "createObjectURL", originalCreateObjectURL);
    restoreProperty(URL, "revokeObjectURL", originalRevokeObjectURL);
  });

  it("renders the lesson list and opens a lesson detail", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return responseFor(new URL(url, "http://localhost").pathname);
    });
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <StrictMode>
          <App />
        </StrictMode>,
      );
    });

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
    // 36 controls (Shadow/Dictation/Fill the blank mode toggle, incl. the 5/10/20 daily-goal toggle, Export CSV and the Pronunciation check toggle) plus one button per word in the three shown transcripts (6 + 6 + 3).
    expect(container.querySelectorAll("button")).toHaveLength(51);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("listens to a sentence at the clamped target speed", async () => {
    const speak = vi.fn();
    const cancel = vi.fn();
    class FakeUtterance {
      lang = "";
      rate = 1;
      constructor(readonly text: string) {}
    }
    vi.stubGlobal("speechSynthesis", { speak, cancel });
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    installMediaDevices(async () => {
      throw new Error("recording not used");
    });
    vi.stubGlobal("MediaRecorder", class {});

    const highWpmLesson = { ...greetingsLesson, targetWpm: 1000 };
    const { container, root } = await openLesson(highWpmLesson);

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Listen")
        ?.click();
    });
    expect(speak).toHaveBeenCalledWith(expect.objectContaining({
      text: highWpmLesson.sentences[0].text,
      rate: 2,
      lang: "en-US",
    }));
    expect(cancel).toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    container.remove();

    const lowWpmLesson = { ...greetingsLesson, targetWpm: 1 };
    const low = await openLesson(lowWpmLesson);
    await act(async () => {
      Array.from(low.container.querySelectorAll("button"))
        .find((button) => button.textContent === "Listen")
        ?.click();
    });
    expect(speak).toHaveBeenLastCalledWith(expect.objectContaining({ rate: 0.5 }));
    await act(async () => {
      low.root.unmount();
    });
    low.container.remove();
  });

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

  it("records dictation practice and shows the streak witness", async () => {
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
      setInputValue(input, greetingsLesson.sentences[0].text);
      input.form?.requestSubmit();
    });
    await waitForCondition(() => container.textContent?.includes("1 day streak") ?? false);

    expect(await getPracticeDays()).toHaveLength(1);
    expect(container.textContent).toContain("1 day streak");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("drills fill-the-blank: hides the word, checks, records, resets, and plays", async () => {
    const speak = vi.fn();
    class FakeUtterance {
      lang = "";
      rate = 1;
      constructor(readonly text: string) {}
    }
    vi.stubGlobal("speechSynthesis", { speak, cancel: vi.fn() });
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);
    const { container, root } = await openLesson();
    const [first, second] = greetingsLesson.sentences;
    const button = (label: string) =>
      Array.from(container.querySelectorAll("button")).find(
        (candidate) => candidate.textContent?.includes(label),
      );
    const submit = async (input: HTMLInputElement, value: string) => {
      await act(async () => {
        setInputValue(input, value);
        input.form?.requestSubmit();
      });
    };

    await act(async () => {
      button("Fill the blank")?.click();
    });
    expect(container.textContent).toContain("Good ____, how are you today?");
    expect(container.textContent).not.toContain("morning");
    expect(container.querySelector(`label[for="blank-${first.id}"]`)).not.toBeNull();
    expect(container.textContent).toContain("Goal 0/10");

    await act(async () => {
      button("Play")?.click();
    });
    expect(speak).toHaveBeenCalledWith(expect.objectContaining({ text: first.text }));

    const input = container.querySelector<HTMLInputElement>(`#blank-${first.id}`);
    if (!input) throw new Error("blank input not found");
    await submit(input, " MORNING! ");
    expect(container.textContent).toContain("Correct");
    await waitForCondition(() => container.textContent?.includes("Goal 1/10") ?? false);

    await act(async () => {
      button("Try again")?.click();
    });
    expect(input.value).toBe("");
    expect(container.textContent).not.toContain("Correct");

    const secondInput = container.querySelector<HTMLInputElement>(`#blank-${second.id}`);
    if (!secondInput) throw new Error("second blank input not found");
    await submit(secondInput, "meet");
    expect(container.textContent).toContain("Not quite — the word was nice");
    await waitForCondition(() => container.textContent?.includes("Goal 2/10") ?? false);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("marks a lesson complete and shows its badge", async () => {
    const { container, root } = await openLesson();

    const completeButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Mark complete",
    );
    if (!completeButton) throw new Error("Mark complete button not found");
    await act(async () => {
      completeButton.click();
    });
    await waitForCondition(() => container.textContent?.includes("Completed") ?? false);

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Back to lessons"))
        ?.click();
    });
    await waitForCondition(() => {
      const lessonButton = Array.from(container.querySelectorAll("button")).find(
        (button) => button.textContent?.includes("Greetings & Basics"),
      );
      return lessonButton?.textContent?.includes("Completed") ?? false;
    });
    expect(container.textContent).toContain("Completed");

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

  it("records, stops, replays, and releases the microphone", async () => {
    const cancel = vi.fn();
    vi.stubGlobal("speechSynthesis", { speak: vi.fn(), cancel });
    vi.stubGlobal("SpeechSynthesisUtterance", class {});
    const trackStop = vi.fn();
    const stream = { getTracks: () => [{ stop: trackStop }] } as unknown as MediaStream;
    installMediaDevices(async () => stream);
    const { revokeObjectURL } = installObjectUrlFakes();
    class FakeMediaRecorder {
      static instances: FakeMediaRecorder[] = [];
      state = "inactive";
      mimeType = "audio/webm";
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onstop: (() => void) | null = null;

      constructor(readonly recordedStream: MediaStream) {
        FakeMediaRecorder.instances.push(this);
      }

      start(): void {
        this.state = "recording";
      }

      stop(): void {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["audio"]) } as BlobEvent);
        this.onstop?.();
      }
    }
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);

    const { container, root } = await openLesson();
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Record")
        ?.click();
    });
    expect(container.textContent).toContain("Stop");

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Stop")
        ?.click();
    });
    expect(container.querySelector("audio")?.getAttribute("src")).toMatch(/^blob:/);
    expect(trackStop).toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    expect(cancel).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:recording-1");
    container.remove();
  });

  it("shows a visible message when microphone permission is denied", async () => {
    vi.stubGlobal("speechSynthesis", { speak: vi.fn(), cancel: vi.fn() });
    vi.stubGlobal("SpeechSynthesisUtterance", class {});
    installMediaDevices(async () => {
      throw new DOMException("Permission denied", "NotAllowedError");
    });
    vi.stubGlobal("MediaRecorder", class {});

    const { container, root } = await openLesson();
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Record")
        ?.click();
    });
    expect(container.textContent).toContain(
      "Unable to access the microphone. Please allow microphone access to record.",
    );
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("persists only one card when save is clicked twice synchronously", async () => {
    const { container, root } = await openLesson();
    const sentence = greetingsLesson.sentences[0];
    const saveButton = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Save to review",
    );
    if (!saveButton) throw new Error("Save to review button not found");

    await act(async () => {
      saveButton.click();
      saveButton.click();
    });
    await waitForCondition(() => container.textContent?.includes("Saved") ?? false);
    await act(async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    });

    const cards = await getAllCards();
    expect(
      cards.filter((card) => card.source.sentenceId === sentence.id),
    ).toHaveLength(1);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("persists saved cards across an app remount", async () => {
    const first = await openLesson();
    const firstSave = Array.from(first.container.querySelectorAll("button")).find(
      (button) => button.textContent === "Save to review",
    );

    await act(async () => {
      firstSave?.click();
    });
    await waitForCondition(() => first.container.textContent?.includes("Saved") ?? false);

    await act(async () => {
      first.root.unmount();
    });
    first.container.remove();

    const secondContainer = document.createElement("div");
    document.body.appendChild(secondContainer);
    const secondRoot = createRoot(secondContainer);
    await act(async () => {
      secondRoot.render(
        <StrictMode>
          <App />
        </StrictMode>,
      );
    });
    await act(async () => {
      Array.from(secondContainer.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Review"))
        ?.click();
    });
    await waitForCondition(
      () => secondContainer.textContent?.includes(greetingsLesson.sentences[0].text) ?? false,
    );

    expect(secondContainer.textContent).toContain(
      greetingsLesson.sentences[0].text,
    );

    await act(async () => {
      secondRoot.unmount();
    });
    secondContainer.remove();
  });

  it("rates a card once when rating buttons are clicked synchronously", async () => {
    const { container, root } = await openLesson();
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

    const showAnswer = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Show answer",
    );
    await act(async () => {
      showAnswer?.click();
    });
    await waitForCondition(
      () =>
        Array.from(container.querySelectorAll("button")).some(
          (button) => button.textContent === "Good",
        ),
    );

    const good = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Good",
    );
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

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("moves focus to what replaced the control on lesson open, save, Back, show answer, and rating", async () => {
    const { container, root } = await openLesson();
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

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("exports all stored cards as a CSV download", async () => {
    await putCard(
      createCard(
        { front: 'say "hi"', back: "chào, bạn", source: { lessonId: "l", sentenceId: "s", word: "" } },
        new Date(),
      ),
    );
    const blobs: Blob[] = [];
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn((blob: Blob) => {
        blobs.push(blob);
        return "blob:csv";
      }),
    });
    const downloads: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      downloads.push(this.download);
    });
    const { container, root } = await openLesson();

    await act(async () => {
      buttonsNamed(container, "Export CSV")[0]?.click();
    });
    await waitForCondition(() => downloads.length > 0);

    expect(blobs).toHaveLength(1);
    expect(blobs[0]?.type).toBe("text/csv;charset=utf-8");
    expect(await blobs[0]?.text()).toBe(cardsCsv(await getAllCards()));
    expect(downloads).toEqual([`road-to-english-cards-${todayKey(new Date())}.csv`]);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("imports a backup through the UI and refreshes the deck and streak", async () => {
    const existing = createCard(
      {
        front: "old card",
        back: "old answer",
        source: { lessonId: "old-lesson", sentenceId: "old-sentence", word: "" },
      },
      new Date(),
    );
    await putCard(existing);
    await recordPractice("2025-01-01", { newCard: false });

    const importedCard = createCard(
      {
        front: "imported card",
        back: "imported answer",
        source: { lessonId: "lesson-1", sentenceId: "sentence-1", word: "" },
      },
      new Date(),
    );
    const text = exportData(
      {
        cards: [importedCard],
        practiceDays: [{ date: todayKey(new Date()) }],
        lessonCompletion: [{ lessonId: "lesson-1" }],
        userLessons: [],
      },
      new Date(),
    );
    vi.stubGlobal("confirm", () => true);
    const { container, root } = await openLesson();
    const input = container.querySelector<HTMLInputElement>(
      'input[type="file"]',
    );
    if (!input) throw new Error("backup file input not found");

    await act(async () => {
      Object.defineProperty(input, "files", {
        configurable: true,
        value: [new File([text], "backup.json", { type: "application/json" })],
      });
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await waitForCondition(() => container.textContent?.includes("1 day streak") ?? false);

    expect(container.textContent).toContain("1 day streak");
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent?.includes("Review"))
        ?.click();
    });
    await waitForCondition(() => container.textContent?.includes("imported card") ?? false);
    expect(container.textContent).toContain("imported card");
    expect(container.textContent).not.toContain("old card");
    expect(await getAllCards()).toHaveLength(1);
    expect(await getPracticeDays()).toHaveLength(1);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("explains when shadowing browser APIs are unsupported", async () => {
    removeBrowserGlobals();
    const { container, root } = await openLesson();

    expect(container.textContent).toContain(
      "Listen disabled: speech synthesis is not supported in this browser.",
    );
    expect(container.textContent).toContain(
      "Recording disabled: microphone recording is not supported in this browser.",
    );
    expect(Array.from(container.querySelectorAll("button")).filter(
      (button) => button.textContent === "Listen" || button.textContent === "Record",
    ).every((button) => (button as HTMLButtonElement).disabled)).toBe(true);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("syncs exactly once after sign-in", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(url, "http://localhost").pathname;
      if (path === "/me") return new Response(null, { status: 401 });
      if (path === "/login") {
        return new Response(JSON.stringify({ id: "user-1", email: "learner@example.com" }), { status: 200 });
      }
      return responseFor(path);
    });
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <StrictMode>
          <App />
        </StrictMode>,
      );
    });
    const email = container.querySelector<HTMLInputElement>('input[aria-label="Email"]');
    const password = container.querySelector<HTMLInputElement>('input[aria-label="Password"]');
    if (!email || !password) throw new Error("sign-in form not found");
    await act(async () => {
      setInputValue(email, "learner@example.com");
      setInputValue(password, "password");
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Sign in")
        ?.click();
    });
    await waitForCondition(() => fetchMock.mock.calls.filter(([input]) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return new URL(url, "http://localhost").pathname === "/sync";
    }).length === 1);
    expect(fetchMock.mock.calls.filter(([input]) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return new URL(url, "http://localhost").pathname === "/sync";
    })).toHaveLength(1);

    await act(async () => root.unmount());
    container.remove();
  });

  it("syncs exactly once after /me restores a user", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(url, "http://localhost").pathname;
      if (path === "/me") return new Response(JSON.stringify({ id: "user-1", email: "restored@example.com" }), { status: 200 });
      return responseFor(path);
    });
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <StrictMode>
          <App />
        </StrictMode>,
      );
    });
    await waitForCondition(() => fetchMock.mock.calls.filter(([input]) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return new URL(url, "http://localhost").pathname === "/sync";
    }).length === 1);
    expect(fetchMock.mock.calls.filter(([input]) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return new URL(url, "http://localhost").pathname === "/sync";
    })).toHaveLength(1);

    await act(async () => root.unmount());
    container.remove();
  });

  it("shows the owner mismatch message and sends no sync", async () => {
    const { claimOwner } = await import("./lib/backupStore");
    await claimOwner("another-user");
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(url, "http://localhost").pathname;
      if (path === "/me") return new Response(JSON.stringify({ id: "user-1", email: "restored@example.com" }), { status: 200 });
      return responseFor(path);
    });
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <StrictMode>
          <App />
        </StrictMode>,
      );
    });
    await waitForCondition(() => container.textContent?.includes("This device's data belongs to another account") ?? false);
    expect(fetchMock.mock.calls.some(([input]) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return new URL(url, "http://localhost").pathname === "/sync";
    })).toBe(false);

    await act(async () => root.unmount());
    container.remove();
  });

  it("signs in and signs out without reloading", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(url, "http://localhost").pathname;
      if (path === "/me") return new Response(null, { status: 401 });
      if (path === "/login") {
        return new Response(JSON.stringify({ id: "user-1", email: "learner@example.com" }), {
          status: 200,
        });
      }
      if (path === "/logout") return new Response(null, { status: 204 });
      return responseFor(path);
    });
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <StrictMode>
          <App />
        </StrictMode>,
      );
    });

    expect(container.textContent).not.toContain("learner@example.com");
    const email = container.querySelector<HTMLInputElement>('input[aria-label="Email"]');
    const password = container.querySelector<HTMLInputElement>('input[aria-label="Password"]');
    if (!email || !password) throw new Error("sign-in form not found");
    await act(async () => {
      setInputValue(email, "learner@example.com");
      setInputValue(password, "password");
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Sign in")
        ?.click();
    });
    await waitForCondition(() => container.textContent?.includes("learner@example.com") ?? false);
    // The form that held focus is gone, so focus moves to the control that replaced it.
    expect(document.activeElement?.textContent).toBe("Sign out");

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Sign out")
        ?.click();
    });
    await waitForCondition(() => container.textContent?.includes("Sign in") ?? false);
    expect(container.textContent).not.toContain("learner@example.com");
    expect(document.activeElement).toBe(container.querySelector('input[aria-label="Email"]'));

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("restores a signed-in session from /me", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(url, "http://localhost").pathname;
      if (path === "/me") {
        return new Response(JSON.stringify({ id: "user-1", email: "restored@example.com" }), {
          status: 200,
        });
      }
      return responseFor(path);
    });
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <StrictMode>
          <App />
        </StrictMode>,
      );
    });
    await waitForCondition(() => container.textContent?.includes("restored@example.com") ?? false);
    expect(container.querySelector('input[aria-label="Email"]')).toBeNull();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("rejects a short sign-up password without sending a request", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return responseFor(new URL(url, "http://localhost").pathname);
    });
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <StrictMode>
          <App />
        </StrictMode>,
      );
    });

    const email = container.querySelector<HTMLInputElement>('input[aria-label="Email"]');
    const password = container.querySelector<HTMLInputElement>('input[aria-label="Password"]');
    if (!email || !password) throw new Error("sign-up form not found");
    await act(async () => {
      setInputValue(email, "learner@example.com");
      setInputValue(password, "short");
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Sign up")
        ?.click();
    });

    expect(container.textContent).toContain(
      "Password must be at least 8 characters (and at most 72 bytes).",
    );
    expect(fetchMock.mock.calls.some(([input]) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return new URL(url, "http://localhost").pathname === "/signup";
    })).toBe(false);

    await act(async () => root.unmount());
    container.remove();
  });

  it("shows the email and password message for a sign-up 400", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(url, "http://localhost").pathname;
      if (path === "/signup") return new Response(null, { status: 400 });
      return responseFor(path);
    });
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <StrictMode>
          <App />
        </StrictMode>,
      );
    });

    const email = container.querySelector<HTMLInputElement>('input[aria-label="Email"]');
    const password = container.querySelector<HTMLInputElement>('input[aria-label="Password"]');
    if (!email || !password) throw new Error("sign-up form not found");
    await act(async () => {
      setInputValue(email, "learner@example.com");
      setInputValue(password, "password");
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Sign up")
        ?.click();
    });
    await waitForCondition(() => container.textContent?.includes(
      "Check your email address and password. Password must be at least 8 characters (and at most 72 bytes).",
    ) ?? false);

    expect(container.textContent).toContain(
      "Check your email address and password. Password must be at least 8 characters (and at most 72 bytes).",
    );

    await act(async () => root.unmount());
    container.remove();
  });

  it("shows an inline sign-in error and stays signed out", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(url, "http://localhost").pathname;
      if (path === "/me" || path === "/login") return new Response(null, { status: path === "/me" ? 401 : 401 });
      return responseFor(path);
    });
    vi.stubGlobal("fetch", fetchMock);

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(
        <StrictMode>
          <App />
        </StrictMode>,
      );
    });

    const email = container.querySelector<HTMLInputElement>('input[aria-label="Email"]');
    const password = container.querySelector<HTMLInputElement>('input[aria-label="Password"]');
    if (!email || !password) throw new Error("sign-in form not found");
    await act(async () => {
      setInputValue(email, "learner@example.com");
      setInputValue(password, "wrong");
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Sign in")
        ?.click();
    });
    await waitForCondition(() => container.textContent?.includes("Invalid email or password.") ?? false);
    expect(container.querySelector('input[aria-label="Email"]')).not.toBeNull();
    expect(container.textContent).not.toContain("learner@example.com");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("scales the clamped shadowing rate by the chosen speed", async () => {
    const speech = installSpeechFakes();
    const rateAt = async (container: HTMLElement, speed: string) => {
      await act(async () => {
        buttonsNamed(container, speed)[0]?.click();
      });
      await act(async () => {
        buttonsNamed(container, "Listen")[0]?.click();
      });
      return speech.spoken.at(-1)?.rate;
    };

    const a2 = await openLesson({ ...greetingsLesson, targetWpm: 90 });
    expect(await rateAt(a2.container, "1x")).toBe(0.5);
    expect(await rateAt(a2.container, "0.75x")).toBe(0.375);
    expect(await rateAt(a2.container, "0.5x")).toBe(0.25);
    await act(async () => {
      a2.root.unmount();
    });
    a2.container.remove();

    const low = await openLesson({ ...greetingsLesson, targetWpm: 1 });
    expect(await rateAt(low.container, "1x")).toBe(0.5);
    await act(async () => {
      low.root.unmount();
    });
    low.container.remove();

    const high = await openLesson({ ...greetingsLesson, targetWpm: 1000 });
    expect(await rateAt(high.container, "1x")).toBe(2);
    expect(await rateAt(high.container, "0.5x")).toBe(1);
    await act(async () => {
      high.root.unmount();
    });
    high.container.remove();
  });

  it("highlights the spoken word of the playing sentence and clears it on end", async () => {
    const speech = installSpeechFakes();
    const { container, root } = await openLesson();
    const spokenWords = () =>
      Array.from(container.querySelectorAll('[aria-current="true"]')).map(
        (element) => element.textContent,
      );
    const boundary = (charIndex: number) =>
      act(async () => {
        speech.spoken.at(-1)?.onboundary?.({ name: "word", charIndex });
      });

    await act(async () => {
      buttonsNamed(container, "Listen")[0]?.click();
    });
    expect(spokenWords()).toEqual([]);
    await boundary(0);
    expect(spokenWords()).toEqual(["Good"]);
    await boundary(4);
    expect(spokenWords()).toEqual([]);
    await boundary(14);
    expect(spokenWords()).toEqual(["how"]);
    await boundary(7);
    expect(spokenWords()).toEqual(["morning"]);
    await act(async () => {
      speech.finish();
    });
    expect(spokenWords()).toEqual([]);

    await act(async () => {
      buttonsNamed(container, "Listen")[0]?.click();
    });
    await act(async () => {
      speech.finish();
    });
    expect(spokenWords()).toEqual([]);

    await act(async () => {
      buttonsNamed(container, "Listen")[0]?.click();
    });
    const first = speech.spoken.at(-1);
    await boundary(0);
    await act(async () => {
      buttonsNamed(container, "Listen")[1]?.click();
    });
    expect(spokenWords()).toEqual([]);
    await act(async () => {
      first?.onboundary?.({ name: "word", charIndex: 5 });
    });
    expect(spokenWords()).toEqual([]);
    await boundary(3);
    expect(spokenWords()).toEqual(["is"]);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("loops a sentence until toggled off, another sentence starts, or unmount", async () => {
    const speech = installSpeechFakes();
    const { container, root } = await openLesson();
    const first = greetingsLesson.sentences[0].text;

    await act(async () => {
      buttonsNamed(container, "Loop")[0]?.click();
    });
    expect(buttonsNamed(container, "Loop")[0]?.getAttribute("aria-pressed")).toBe("true");
    expect(speech.spoken.map((utterance) => utterance.text)).toEqual([first]);
    await act(async () => {
      speech.finish();
    });
    await act(async () => {
      speech.finish();
    });
    expect(speech.spoken.map((utterance) => utterance.text)).toEqual([first, first, first]);

    speech.cancel.mockClear();
    await act(async () => {
      buttonsNamed(container, "Loop")[0]?.click();
    });
    expect(speech.cancel).toHaveBeenCalled();
    expect(buttonsNamed(container, "Loop")[0]?.getAttribute("aria-pressed")).toBe("false");
    await act(async () => {
      speech.spoken.at(-1)?.onend?.();
    });
    expect(speech.spoken).toHaveLength(3);

    await act(async () => {
      buttonsNamed(container, "Loop")[0]?.click();
    });
    await act(async () => {
      buttonsNamed(container, "Listen")[1]?.click();
    });
    expect(buttonsNamed(container, "Loop")[0]?.getAttribute("aria-pressed")).toBe("false");
    await act(async () => {
      speech.finish();
    });
    expect(speech.spoken.map((utterance) => utterance.text).slice(3)).toEqual([
      first,
      greetingsLesson.sentences[1].text,
    ]);

    await act(async () => {
      buttonsNamed(container, "Loop")[0]?.click();
    });
    const lastLooped = speech.spoken.at(-1);
    speech.cancel.mockClear();
    await act(async () => {
      root.unmount();
    });
    expect(speech.cancel).toHaveBeenCalled();
    const spokenAtUnmount = speech.spoken.length;
    lastLooped?.onend?.();
    expect(speech.spoken).toHaveLength(spokenAtUnmount);
    container.remove();
  });

  it("compares by playing the recording only after the reference ends, and explains a blocked play", async () => {
    const speech = installSpeechFakes();
    const stream = { getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream;
    installMediaDevices(async () => stream);
    installObjectUrlFakes();
    class FakeMediaRecorder {
      state = "inactive";
      mimeType = "audio/webm";
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onstop: (() => void) | null = null;

      start(): void {
        this.state = "recording";
      }

      stop(): void {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["audio"]) } as BlobEvent);
        this.onstop?.();
      }
    }
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined);

    const { container, root } = await openLesson();
    expect(buttonsNamed(container, "Compare")[0]?.disabled).toBe(true);

    await act(async () => {
      buttonsNamed(container, "Record")[0]?.click();
    });
    await act(async () => {
      buttonsNamed(container, "Stop")[0]?.click();
    });
    const compare = buttonsNamed(container, "Compare")[0];
    expect(compare?.disabled).toBe(false);

    await act(async () => {
      compare?.click();
    });
    expect(speech.spoken.at(-1)?.text).toBe(greetingsLesson.sentences[0].text);
    expect(play).not.toHaveBeenCalled();
    await act(async () => {
      speech.finish();
    });
    expect(play).toHaveBeenCalledTimes(1);
    expect(play.mock.contexts[0]).toBe(container.querySelector("audio"));
    expect(container.textContent).not.toContain("Press play to hear your recording.");

    play.mockRejectedValueOnce(new DOMException("blocked", "NotAllowedError"));
    await act(async () => {
      compare?.click();
    });
    await act(async () => {
      speech.finish();
    });
    expect(container.textContent).toContain("Press play to hear your recording.");

    await act(async () => {
      compare?.click();
    });
    expect(container.textContent).not.toContain("Press play to hear your recording.");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("hides and restores the shadowing transcript", async () => {
    installSpeechFakes();
    const { container, root } = await openLesson();

    await act(async () => {
      buttonsNamed(container, "Hide transcript")[0]?.click();
    });
    for (const sentence of greetingsLesson.sentences) {
      expect(container.textContent).not.toContain(sentence.text);
    }
    expect(container.textContent).not.toContain("casual sign-off");

    await act(async () => {
      buttonsNamed(container, "Show transcript")[0]?.click();
    });
    for (const sentence of greetingsLesson.sentences) {
      expect(container.textContent).toContain(sentence.text);
    }
    expect(container.textContent).toContain("casual sign-off");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("toggles Vietnamese independently of the transcript", async () => {
    installSpeechFakes();
    const { container, root } = await openLesson();

    for (const sentence of greetingsLesson.sentences) {
      expect(container.textContent).not.toContain(sentence.vi);
    }

    await act(async () => {
      buttonsNamed(container, "Show Vietnamese")[0]?.click();
    });
    for (const sentence of greetingsLesson.sentences) {
      expect(container.textContent).toContain(sentence.vi);
    }

    await act(async () => {
      buttonsNamed(container, "Hide transcript")[0]?.click();
    });
    for (const sentence of greetingsLesson.sentences) {
      expect(container.textContent).not.toContain(sentence.text);
      expect(container.textContent).toContain(sentence.vi);
    }

    await act(async () => {
      buttonsNamed(container, "Hide Vietnamese")[0]?.click();
    });
    for (const sentence of greetingsLesson.sentences) {
      expect(container.textContent).not.toContain(sentence.vi);
    }

    await act(async () => {
      buttonsNamed(container, "Show transcript")[0]?.click();
    });
    for (const sentence of greetingsLesson.sentences) {
      expect(container.textContent).toContain(sentence.text);
      expect(container.textContent).not.toContain(sentence.vi);
    }

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("shows Hear and Save for a clicked word and speaks the word after stopping Loop", async () => {
    const speech = installSpeechFakes();
    const { container, root } = await openLesson();
    const sentence = greetingsLesson.sentences[0];

    expect(buttonsNamed(container, "Hear word")).toHaveLength(0);
    expect(container.textContent).toContain(sentence.text);
    await act(async () => {
      buttonsNamed(container, "Loop")[0]?.click();
    });
    await act(async () => {
      buttonsNamed(container, "morning")[0]?.click();
    });
    expect(buttonsNamed(container, "Hear word")).toHaveLength(1);
    expect(buttonsNamed(container, "Save word")).toHaveLength(1);

    await act(async () => {
      buttonsNamed(container, "Hear word")[0]?.click();
    });
    expect(buttonsNamed(container, "Loop")[0]?.getAttribute("aria-pressed")).toBe("false");
    expect(speech.spoken.at(-1)?.text).toBe("morning");
    await act(async () => {
      speech.finish();
    });
    expect(speech.spoken.at(-1)?.text).toBe("morning");

    await act(async () => {
      buttonsNamed(container, "nice")[0]?.click();
    });
    expect(buttonsNamed(container, "Hear word")).toHaveLength(1);
    expect(container.textContent).not.toContain("morningHear word");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("saves one word card under a synchronous double click, keeps it Saved across a remount, and reviews it", async () => {
    installSpeechFakes();
    const { container, root } = await openLesson();
    const sentence = greetingsLesson.sentences[0];

    await act(async () => {
      buttonsNamed(container, "morning")[0]?.click();
    });
    const save = buttonsNamed(container, "Save word")[0];
    if (!save) throw new Error("Save word button not found");
    // putCard is keyed by id, so a second write would not change the card count; count the writes.
    const put = vi.spyOn(IDBObjectStore.prototype, "put");
    await act(async () => {
      save.click();
      save.click();
    });
    await waitForCondition(() => buttonsNamed(container, "Saved").length === 1);
    await act(async () => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    });

    expect(put.mock.contexts.filter((store) => (store as IDBObjectStore).name === "cards")).toHaveLength(1);
    put.mockRestore();
    const cards = await getAllCards();
    expect(cards).toHaveLength(1);
    expect(cards[0]).toMatchObject({
      id: `greetings-basics:${sentence.id}:morning`,
      front: "morning",
      back: `${sentence.text} — ${sentence.vi}`,
      source: { lessonId: "greetings-basics", sentenceId: sentence.id, word: "morning" },
    });
    expect(buttonsNamed(container, "Save to review")).toHaveLength(3);

    await act(async () => {
      root.unmount();
    });
    container.remove();

    const second = await openLesson();
    await act(async () => {
      buttonsNamed(second.container, "morning")[0]?.click();
    });
    await waitForCondition(() => buttonsNamed(second.container, "Saved").length === 1);
    expect(buttonsNamed(second.container, "Save word")).toHaveLength(0);

    await act(async () => {
      buttonsNamed(second.container, "Review")[0]?.click();
    });
    await waitForCondition(() => second.container.textContent?.includes("Show answer") ?? false);
    expect(second.container.textContent).toContain("morning");
    await act(async () => {
      buttonsNamed(second.container, "Show answer")[0]?.click();
    });
    expect(second.container.textContent).toContain(`${sentence.text} — ${sentence.vi}`);
    await act(async () => {
      buttonsNamed(second.container, "Good")[0]?.click();
    });
    await waitForCondition(() => second.container.textContent?.includes("All caught up") ?? false);
    const [reviewed] = await getAllCards();
    expect(reviewed?.fsrs.reps).toBe(1);

    await act(async () => {
      second.root.unmount();
    });
    second.container.remove();
  });

  it("removes a saved card with the Saved toggle, offers Undo that restores it, and re-saves it fresh", async () => {
    const sentence = greetingsLesson.sentences[0];
    const created = new Date("2026-01-01T00:00:00.000Z");
    const original = createCard(
      { front: sentence.text, back: "", source: { lessonId: "greetings-basics", sentenceId: sentence.id, word: "" } },
      created,
    );
    await putCard(original);
    const { container, root } = await openLesson();
    const showView = async (name: "Review" | "Library") => {
      await act(async () => {
        buttonsNamed(container, name)[0]?.click();
      });
    };
    // Library lists the lessons, so going back to the lesson reopens it from its row.
    const reopenLesson = async () => {
      await showView("Library");
      await reopenGreetings(container);
    };
    const dueBadge = () => container.textContent?.match(/(\d+) due/)?.[1];
    const stored = async () => (await getAllCards()).find(({ id }) => id === original.id);

    await showView("Review");
    await waitForCondition(() => dueBadge() === "1");
    await reopenLesson();
    await waitForCondition(() => buttonsNamed(container, "Saved").length === 1);
    const toggle = buttonsNamed(container, "Saved")[0]!;
    expect(toggle.getAttribute("aria-label")).toBe("Saved, remove from review deck");
    toggle.focus();
    await act(async () => {
      toggle.click();
    });
    await waitForCondition(() => buttonsNamed(container, "Save to review").length === 3);
    expect(document.activeElement).toBe(toggle);
    expect(toggle.getAttribute("aria-label")).toBeNull();
    expect((await stored())?.deletedAt).not.toBeNull();
    await waitForCondition(() => document.body.textContent?.includes("Removed from your review deck.") ?? false);
    await showView("Review");
    await waitForCondition(() => dueBadge() === "0");
    await reopenLesson();

    const undo = buttonsNamed(document.body, "Undo")[0];
    if (!undo) throw new Error("Undo button not found");
    await act(async () => {
      undo.click();
    });
    await waitForCondition(() => buttonsNamed(container, "Saved").length === 1);
    const restored = await stored();
    expect(restored).toMatchObject({ fsrs: original.fsrs, deletedAt: null });
    expect(Date.parse(restored!.updatedAt)).toBeGreaterThan(created.getTime());
    await showView("Review");
    await waitForCondition(() => dueBadge() === "1");
    await reopenLesson();

    await waitForCondition(() => buttonsNamed(container, "Saved").length === 1);
    await act(async () => {
      buttonsNamed(container, "Saved")[0]!.click();
    });
    await waitForCondition(() => buttonsNamed(container, "Save to review").length === 3);
    await act(async () => {
      buttonsNamed(container, "Save to review")[0]!.click();
    });
    await waitForCondition(() => buttonsNamed(container, "Saved").length === 1);
    const resaved = await stored();
    expect(resaved?.deletedAt).toBeNull();
    expect(resaved?.fsrs.due.getTime()).toBeGreaterThan(created.getTime());
    expect(await getAllCards()).toHaveLength(1);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("undoes nothing when the card was re-saved after the remove, keeping the fresh card", async () => {
    const sentence = greetingsLesson.sentences[0];
    const created = new Date("2026-01-01T00:00:00.000Z");
    const original = createCard(
      { front: sentence.text, back: "", source: { lessonId: "greetings-basics", sentenceId: sentence.id, word: "" } },
      created,
    );
    await putCard(original);
    const { container, root } = await openLesson();
    const showView = async (name: "Review" | "Library") => {
      await act(async () => {
        buttonsNamed(container, name)[0]?.click();
      });
    };
    // Library lists the lessons, so going back to the lesson reopens it from its row.
    const reopenLesson = async () => {
      await showView("Library");
      await reopenGreetings(container);
    };
    const dueBadge = () => container.textContent?.match(/(\d+) due/)?.[1];
    const stored = async () => (await getAllCards()).find(({ id }) => id === original.id);

    await showView("Review");
    await waitForCondition(() => dueBadge() === "1");
    await reopenLesson();
    await waitForCondition(() => buttonsNamed(container, "Saved").length === 1);
    // Earlier tests can leave toasts in document.body; this test's toast is the newest Undo.
    const undoCount = buttonsNamed(document.body, "Undo").length;
    await act(async () => {
      buttonsNamed(container, "Saved")[0]!.click();
    });
    await waitForCondition(() => buttonsNamed(document.body, "Undo").length === undoCount + 1);
    await act(async () => {
      buttonsNamed(container, "Save to review")[0]!.click();
    });
    await waitForCondition(() => buttonsNamed(container, "Saved").length === 1);
    const resaved = await stored();
    expect(resaved?.deletedAt).toBeNull();
    expect(resaved?.fsrs.due.getTime()).toBeGreaterThan(created.getTime());

    const undo = buttonsNamed(document.body, "Undo").at(-1)!;
    await act(async () => {
      undo.click();
    });
    await waitForCondition(
      () => document.body.textContent?.includes("Couldn't undo: this card changed since it was removed.") ?? false,
    );
    // happy-dom runs no CSS transitions; end the toast row's exit transition so a dismissed toast leaves the DOM.
    await act(async () => {
      for (let node = undo.parentElement; node; node = node.parentElement) {
        const end = new Event("transitionend", { bubbles: true });
        Object.defineProperty(end, "propertyName", { value: "grid-template-rows" });
        node.dispatchEvent(end);
      }
    });
    expect(undo.isConnected).toBe(false);
    expect(await stored()).toEqual(resaved);
    await showView("Review");
    await waitForCondition(() => dueBadge() === "1");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  describe("Undo after the Saved toggle unmounted", () => {
    const sentence = greetingsLesson.sentences[0];
    const created = new Date("2026-01-01T00:00:00.000Z");
    const original = createCard(
      { front: sentence.text, back: "", source: { lessonId: "greetings-basics", sentenceId: sentence.id, word: "" } },
      created,
    );
    const stored = async () => (await getAllCards()).find(({ id }) => id === original.id);

    // Removes the saved card, then leaves the lesson so SaveToReview unmounts while its Undo toast stays open.
    async function removeThenLeave() {
      await putCard(original);
      const view = await openLesson();
      const { container } = view;
      await act(async () => {
        buttonsNamed(container, "Review")[0]?.click();
      });
      await waitForCondition(() => container.textContent?.match(/(\d+) due/)?.[1] === "1");
      await act(async () => {
        buttonsNamed(container, "Library")[0]?.click();
      });
      await reopenGreetings(container);
      await waitForCondition(() => buttonsNamed(container, "Saved").length === 1);
      const earlier = new Set(buttonsNamed(document.body, "Undo"));
      const newUndo = () => buttonsNamed(document.body, "Undo").find((button) => !earlier.has(button));
      await act(async () => {
        buttonsNamed(container, "Saved")[0]!.click();
      });
      await waitForCondition(() => newUndo() !== undefined);
      await act(async () => {
        buttonsNamed(container, "Back to lessons")[0]!.click();
      });
      await waitForCondition(() => buttonsNamed(container, "Back to lessons").length === 0);
      expect(buttonsNamed(container, "Saved")).toHaveLength(0);
      expect(buttonsNamed(container, "Save to review")).toHaveLength(0);
      return { ...view, undo: newUndo()! };
    }

    const toastSays = (message: string) => document.body.textContent?.includes(message) ?? false;

    it("shows the changed-card toast and keeps the stored card when the card changed after the remove", async () => {
      const { container, root, undo } = await removeThenLeave();
      const changed = { ...(await stored())!, updatedAt: new Date(Date.now() + 1000).toISOString() };
      await putCard(changed);

      await act(async () => {
        undo.click();
      });
      await waitForCondition(() => toastSays("Couldn't undo: this card changed since it was removed."));
      expect(await stored()).toEqual(changed);

      await act(async () => {
        root.unmount();
      });
      container.remove();
    });

    it("restores the exact FSRS state from a clean tombstone", async () => {
      const { container, root, undo } = await removeThenLeave();
      await act(async () => {
        buttonsNamed(container, "Review")[0]?.click();
      });
      await waitForCondition(() => container.textContent?.match(/(\d+) due/)?.[1] === "0");

      await act(async () => {
        undo.click();
      });
      await waitForCondition(() => container.textContent?.match(/(\d+) due/)?.[1] === "1");
      expect(await stored()).toMatchObject({ fsrs: original.fsrs, deletedAt: null });

      await act(async () => {
        root.unmount();
      });
      container.remove();
    });

    it("shows a try-again toast when the restore throws", async () => {
      const { container, root, undo } = await removeThenLeave();
      const tombstone = await stored();
      vi.spyOn(vocabStore, "restoreTombstone").mockRejectedValueOnce(new Error("quota"));

      await act(async () => {
        undo.click();
      });
      await waitForCondition(() => toastSays("Couldn't undo. Try again."));
      expect(await stored()).toEqual(tombstone);

      await act(async () => {
        root.unmount();
      });
      container.remove();
    });
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
      const { container, root, dueBadge } = await renderWithFutureCard();
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
      await act(async () => {
        root.unmount();
      });
      container.remove();
    });

    it("shows a card that became due when the window regains focus", async () => {
      const { container, root, dueBadge } = await renderWithFutureCard();
      await act(async () => {
        window.dispatchEvent(new Event("focus"));
      });
      await waitForCondition(() => dueBadge() === "1");
      await act(async () => {
        root.unmount();
      });
      container.remove();
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
      const { container, root } = await openLesson();
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

      await act(async () => {
        root.unmount();
      });
      container.remove();
    });

    it("writes nothing, shows the latest card, and records no XP when the stored card changed", async () => {
      const card = newCard();
      await putCard(card);
      const { container, unmount } = await openReview();
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
      await unmount();
    });

    it("does not resurrect a card tombstoned in IndexedDB by a rating", async () => {
      const card = newCard();
      await putCard(card);
      const { container, unmount } = await openReview();
      await press(container, "Show answer");
      const tombstone = deleteCard(card, new Date(Date.now() + 1000));
      await putCard(tombstone);
      const recordPractice = vi.spyOn(progressStore, "recordPractice");

      await press(container, "Good");
      await waitForCondition(() => container.textContent?.includes(staleMessage) ?? false);
      expect(await getAllCards()).toEqual([tombstone]);
      expect(container.textContent).toContain("Nothing to review yet.");
      expect(recordPractice).not.toHaveBeenCalled();
      await unmount();
    });

    it("renders the next card hidden from its first frame after a rating", async () => {
      await putCard(newCard(sentence.text, "answer one"));
      await putCard(newCard(greetingsLesson.sentences[1].text, "answer two", greetingsLesson.sentences[1].id));
      const { container, unmount } = await openReview();
      await press(container, "Show answer");
      expect(container.textContent).toContain("answer one");
      const added = addedText(container);

      await press(container, "Good");
      await waitForCondition(() => container.textContent?.includes(greetingsLesson.sentences[1].text) ?? false);
      await waitForCondition(() => buttonsNamed(container, "Show answer").length === 1);
      expect(added().some((text) => text.includes("answer two"))).toBe(false);
      expect(container.textContent).not.toContain("answer two");
      await unmount();
    });

    it("brings a card rated Again back in the session, hidden, when it becomes due", async () => {
      await putCard(newCard());
      const { container, unmount } = await openReview();
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
      await unmount();
    });

    it("re-arms a refresh timer that fires before the card is due", async () => {
      await putCard(newCard());
      const { container, unmount } = await openReview();
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
      await unmount();
    });
  });

  it("removes word buttons and the word panel when the transcript is hidden", async () => {
    installSpeechFakes();
    const { container, root } = await openLesson();

    await act(async () => {
      buttonsNamed(container, "morning")[0]?.click();
    });
    expect(buttonsNamed(container, "Hear word")).toHaveLength(1);
    await act(async () => {
      buttonsNamed(container, "Hide transcript")[0]?.click();
    });
    expect(buttonsNamed(container, "morning")).toHaveLength(0);
    expect(buttonsNamed(container, "Hear word")).toHaveLength(0);
    expect(buttonsNamed(container, "Save word")).toHaveLength(0);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  describe("word dictionary", () => {
    const dictionaryPrefix = "https://api.dictionaryapi.dev/";

    function urlOf(input: Parameters<typeof fetch>[0]): string {
      return typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    }

    function dictionaryCalls(): string[] {
      return fetchMock.mock.calls.map(([input]) => urlOf(input)).filter((url) => url.startsWith(dictionaryPrefix));
    }

    // Routes dictionary requests to `dictionary`, everything else to the lesson API fake.
    function routeDictionary(dictionary: (url: string) => Promise<Response>): void {
      const api = fetchMock.getMockImplementation();
      fetchMock.mockImplementation(async (input, init) => {
        const url = urlOf(input);
        return url.startsWith(dictionaryPrefix) ? dictionary(url) : api!(input, init);
      });
    }

    function definitionFor(word: string): Response {
      return new Response(
        JSON.stringify([
          {
            word,
            phonetic: `/${word}/`,
            meanings: [{ partOfSpeech: "noun", definitions: [{ definition: `Meaning of ${word}.` }] }],
          },
        ]),
        { status: 200 },
      );
    }

    it("looks a word up only when Define is clicked", async () => {
      installSpeechFakes();
      const { container, root } = await openLesson();
      routeDictionary(async (url) => definitionFor(url.split("/").at(-1)!));

      await act(async () => {
        buttonsNamed(container, "morning")[0]?.click();
      });
      expect(dictionaryCalls()).toHaveLength(0);

      await act(async () => {
        buttonsNamed(container, "Define")[0]?.click();
      });
      await waitForCondition(() => container.textContent?.includes("Meaning of morning.") ?? false);
      expect(dictionaryCalls()).toEqual(["https://api.dictionaryapi.dev/api/v2/entries/en/morning"]);
      expect(container.textContent).toContain("/morning/");
      expect(container.textContent).toContain("noun");

      await act(async () => {
        root.unmount();
      });
      container.remove();
    });

    it("shows No definition when the lookup fails", async () => {
      installSpeechFakes();
      const { container, root } = await openLesson();
      routeDictionary(async () => new Response(JSON.stringify({ title: "No Definitions Found" }), { status: 404 }));

      await act(async () => {
        buttonsNamed(container, "morning")[0]?.click();
      });
      await act(async () => {
        buttonsNamed(container, "Define")[0]?.click();
      });
      await waitForCondition(() => container.textContent?.includes("No definition") ?? false);

      await act(async () => {
        root.unmount();
      });
      container.remove();
    });

    it("never shows a late definition for the previous word under a newly selected word", async () => {
      installSpeechFakes();
      const { container, root } = await openLesson();
      let resolveMorning: (response: Response) => void = () => {};
      routeDictionary(
        () =>
          new Promise<Response>((resolve) => {
            resolveMorning = resolve;
          }),
      );

      await act(async () => {
        buttonsNamed(container, "morning")[0]?.click();
      });
      await act(async () => {
        buttonsNamed(container, "Define")[0]?.click();
      });
      expect(container.textContent).toContain("Looking up…");

      await act(async () => {
        buttonsNamed(container, "how")[0]?.click();
      });
      expect(container.textContent).not.toContain("Looking up…");
      await act(async () => {
        resolveMorning(definitionFor("morning"));
        for (let attempt = 0; attempt < 5; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      });
      expect(container.textContent).not.toContain("Meaning of morning.");
      expect(container.textContent).not.toContain("No definition");
      expect(buttonsNamed(container, "Define")).toHaveLength(1);

      await act(async () => {
        root.unmount();
      });
      container.remove();
    });

    it("links the normalized word to YouGlish in a new tab without a referrer", async () => {
      installSpeechFakes();
      const { container, root } = await openLesson();

      await act(async () => {
        buttonsNamed(container, "Good")[0]?.click();
      });
      const link = Array.from(container.querySelectorAll("a")).find(
        (anchor) => anchor.textContent === "Hear it on YouGlish",
      );
      expect(link?.getAttribute("href")).toBe(
        "https://youglish.com/pronounce/" + encodeURIComponent("good") + "/english",
      );
      expect(link?.getAttribute("target")).toBe("_blank");
      expect(link?.getAttribute("rel")).toBe("noopener noreferrer");
      expect(dictionaryCalls()).toHaveLength(0);

      await act(async () => {
        root.unmount();
      });
      container.remove();
    });
  });

  describe("daily goal and new-card cap", () => {
    const start = new Date(2026, 0, 5, 12, 0, 0);

    async function renderApp() {
      fetchMock.mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        return responseFor(new URL(url, "http://localhost").pathname);
      });
      vi.stubGlobal("fetch", fetchMock);
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      await act(async () => {
        root.render(
          <StrictMode>
            <App />
          </StrictMode>,
        );
      });
      const unmount = async () => {
        await act(async () => {
          root.unmount();
        });
        container.remove();
      };
      return { container, unmount };
    }

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

    const hasText = (container: HTMLElement, text: string) => () =>
      container.textContent?.includes(text) ?? false;

    afterEach(() => {
      vi.useRealTimers();
      localStorage.clear();
    });

    it("shows the capped due count and shrinks the New allowance after rating a New card", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(start);
      await seedNewCards(21);
      const { container, unmount } = await renderApp();
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
      await unmount();
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
      await second.unmount();
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
      await remounted.unmount();
    });

    it("drops a count loaded before local midnight on the next render", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 0, 5, 23, 59, 0));
      await recordPractice(todayKey(new Date()), { newCard: false });
      const { container, unmount } = await renderApp();
      await waitForCondition(hasText(container, "Goal 1/10"));

      vi.setSystemTime(new Date(2026, 0, 6, 0, 0, 1));
      // Changing the goal re-renders without reloading the counts.
      await act(async () => {
        buttonsNamed(container, "5")[0]?.click();
      });

      expect(container.textContent).toContain("Goal 0/5");
      await unmount();
    });

    it("shows XP and held freezes from seeded practice", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(start);
      for (let offset = 6; offset >= 0; offset -= 1) {
        await recordPractice(todayKey(new Date(2026, 0, 5 - offset)), { newCard: false });
      }
      await recordPractice(todayKey(start), { newCard: false });
      const { container, unmount } = await renderApp();
      await waitForCondition(hasText(container, "80 XP"));

      expect(container.textContent).toContain("7 days streak");
      expect(container.textContent).toContain("Freezes 1/2");
      await unmount();
    });

    it("reads a missing or invalid stored goal as 10", async () => {
      localStorage.setItem("road-to-english.dailyGoal", "7");
      const { container, unmount } = await renderApp();

      expect(container.textContent).toContain("Goal 0/10");
      await unmount();
    });
  });

  describe("user lessons", () => {
    const pasted = "I like green tea.\nDo you   like it?\n\nWe drink it every morning.";

    async function renderApp() {
      fetchMock.mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        return responseFor(new URL(url, "http://localhost").pathname);
      });
      vi.stubGlobal("fetch", fetchMock);
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      await act(async () => {
        root.render(
          <StrictMode>
            <App />
          </StrictMode>,
        );
      });
      await waitForCondition(() => container.textContent?.includes("Your lessons") ?? false);
      return { container, root };
    }

    async function unmount({ container, root }: { container: HTMLElement; root: ReturnType<typeof createRoot> }) {
      await act(async () => {
        root.unmount();
      });
      container.remove();
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
        .map(([input]) => new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost").pathname)
        .filter((path) => path.startsWith("/lessons/"));
    }

    it("creates a lesson from pasted text, opens it without a lesson fetch, and lists it after a remount", async () => {
      const first = await renderApp();
      expect(first.container.textContent).toContain("Your lessons stay on this device; export a backup to move them.");
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
      await unmount(first);

      // The route keeps the created lesson open on a reload; a fresh visit to the app root lists it.
      window.history.replaceState(null, "", "/");
      const second = await renderApp();
      await waitForCondition(() => second.container.textContent?.includes("Tea talk") ?? false);
      expect(second.container.textContent).toContain("B2 · 3 sentences");
      await act(async () => {
        Array.from(second.container.querySelectorAll("button"))
          .find((button) => button.textContent?.includes("Tea talk"))
          ?.click();
      });
      expect(second.container.textContent).toContain("We drink it every morning.");
      expect(lessonFetches()).toEqual([]);
      await unmount(second);
    });

    it("saves a word whose back is the sentence text only, then deletes the lesson and keeps the card", async () => {
      installSpeechFakes();
      const view = await renderApp();
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
      await unmount(view);

      const remounted = await renderApp();
      expect(remounted.container.textContent).toContain("No lessons of your own yet.");
      expect(remounted.container.textContent).not.toContain("Tea talk");
      await unmount(remounted);
    });

    it("creates only one lesson on a synchronous double submit", async () => {
      const first = await renderApp();
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
      await unmount(first);

      // The route keeps the created lesson open on a reload; a fresh visit to the app root lists it.
      window.history.replaceState(null, "", "/");
      const second = await renderApp();
      await waitForCondition(() => second.container.textContent?.includes("Tea talk") ?? false);
      expect(
        Array.from(second.container.querySelectorAll("button")).filter((button) => button.textContent?.includes("Tea talk")),
      ).toHaveLength(1);
      expect(await listUserLessons()).toHaveLength(1);
      await unmount(second);
    });

    it.each([
      ["NUL in the text", "Tea talk", "I like\u0000 tea.", "Title and text must not contain NUL characters."],
      ["an empty title", "   ", pasted, "Title must be 1-100 characters."],
      ["over-limit text", "Tea talk", "a".repeat(20001), "Text must be at most 20000 characters."],
      ["too many sentences", "Tea talk", "Go. ".repeat(201), "Text must contain 1-200 sentences."],
      ["no sentences", "Tea talk", "... !!!", "Text must contain 1-200 sentences."],
    ])("shows an inline error and stores nothing for %s", async (_name, title, text, message) => {
      const view = await renderApp();
      await createLesson(view.container, title, text);

      expect(view.container.textContent).toContain(message);
      expect(view.container.textContent).not.toContain("Back to lessons");
      expect(await listUserLessons()).toEqual([]);
      await unmount(view);
    });

    it("returns to the library after importing a backup while a user lesson is open", async () => {
      const view = await renderApp();
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
      await unmount(view);
    });

    it("runs dictation and the fill-the-blank drill on a user lesson", async () => {
      vi.stubGlobal("speechSynthesis", { speak: vi.fn(), cancel: vi.fn() });
      vi.stubGlobal("SpeechSynthesisUtterance", class {});
      const view = await renderApp();
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
        parts.map((part, i) => (i === index ? "____" : part)).join(""),
      );
      const blank = view.container.querySelector<HTMLInputElement>("#blank-s3");
      if (!blank) throw new Error("blank input not found");
      await act(async () => {
        setInputValue(blank, parts[index]!);
        blank.form?.requestSubmit();
      });
      expect(view.container.textContent).toContain("Correct");
      expect(lessonFetches()).toEqual([]);
      await unmount(view);
    });
  });

  describe("video lessons", () => {
    const transcript = "0:00\nI like green tea.\n0:02\nDo you like it?\n1:05\nWe drink it\nevery morning.";
    const iframeApi = "https://www.youtube.com/iframe_api";

    type PlayerOptions = {
      videoId: string;
      host: string;
      width: string;
      height: string;
      playerVars: object;
      events: { onReady: () => void; onError: () => void; onStateChange: (event: { data: number }) => void };
    };
    class FakePlayer {
      static instances: FakePlayer[] = [];
      calls: unknown[][] = [];
      time = 0;
      constructor(
        readonly element: HTMLElement,
        readonly options: PlayerOptions,
      ) {
        FakePlayer.instances.push(this);
      }
      playVideo() {
        this.calls.push(["playVideo"]);
      }
      pauseVideo() {
        this.calls.push(["pauseVideo"]);
      }
      seekTo(seconds: number, allowSeekAhead: boolean) {
        this.calls.push(["seekTo", seconds, allowSeekAhead]);
      }
      setPlaybackRate(rate: number) {
        this.calls.push(["setPlaybackRate", rate]);
      }
      getCurrentTime() {
        return this.time;
      }
      destroy() {
        this.calls.push(["destroy"]);
      }
    }

    function installYouTube() {
      FakePlayer.instances = [];
      window.YT = { Player: FakePlayer };
    }

    afterEach(() => {
      vi.useRealTimers();
      delete window.YT;
      delete window.onYouTubeIframeAPIReady;
      document.querySelectorAll(`script[src="${iframeApi}"]`).forEach((script) => script.remove());
    });

    async function renderApp() {
      fetchMock.mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        return responseFor(new URL(url, "http://localhost").pathname);
      });
      vi.stubGlobal("fetch", fetchMock);
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      await act(async () => {
        root.render(
          <StrictMode>
            <App />
          </StrictMode>,
        );
      });
      await waitForCondition(() => container.textContent?.includes("Your lessons") ?? false);
      return { container, root };
    }

    async function unmount({ container, root }: { container: HTMLElement; root: ReturnType<typeof createRoot> }) {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }

    async function createLesson(container: HTMLElement, videoUrl: string, text: string) {
      const titleInput = container.querySelector<HTMLInputElement>("#import-title");
      const videoInput = container.querySelector<HTMLInputElement>("#import-video");
      const textArea = container.querySelector<HTMLTextAreaElement>("#import-text");
      if (!titleInput || !videoInput || !textArea) throw new Error("import form not found");
      expect(container.querySelector('label[for="import-video"]')?.textContent).toBe("YouTube URL");
      await act(async () => {
        setInputValue(titleInput, "Tea video");
        setInputValue(videoInput, videoUrl);
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textArea, text);
        textArea.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => {
        titleInput.form?.requestSubmit();
      });
    }

    async function openVideoLesson() {
      installYouTube();
      const view = await renderApp();
      await createLesson(view.container, "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5s", transcript);
      await waitForCondition(() => view.container.textContent?.includes("Back to lessons") ?? false);
      await waitForCondition(() => FakePlayer.instances.length === 1);
      const player = FakePlayer.instances[0]!;
      await act(async () => {
        player.options.events.onReady();
      });
      return { view, player };
    }

    it("creates a video lesson from a URL and a transcript and opens it in a nocookie player", async () => {
      installYouTube();
      const view = await renderApp();
      expect(view.container.textContent).toContain(
        "Paste the transcript from YouTube's Show transcript panel (timestamps included).",
      );
      await createLesson(view.container, "https://youtu.be/dQw4w9WgXcQ", transcript);
      await waitForCondition(() => view.container.textContent?.includes("Back to lessons") ?? false);
      await waitForCondition(() => FakePlayer.instances.length === 1);

      const [player] = FakePlayer.instances;
      expect(player?.options).toMatchObject({
        videoId: "dQw4w9WgXcQ",
        host: "https://www.youtube-nocookie.com",
        playerVars: { playsinline: 1, rel: 0 },
      });
      expect(view.container.contains(player?.element ?? null)).toBe(true);
      const back = buttonsNamed(view.container, "Back to lessons")[0]!;
      const heading = Array.from(view.container.querySelectorAll("h1")).find((node) => node.textContent === "Tea video")!;
      for (const header of [back, heading]) {
        expect(header.compareDocumentPosition(player!.element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      }
      expect(view.container.textContent).toContain("Video from YouTube; playing it connects to YouTube.");
      expect(view.container.textContent).toContain("We drink it every morning.");
      expect(buttonsNamed(view.container, "Play clip")).toHaveLength(3);
      expect(buttonsNamed(view.container, "Play clip").every((button) => button.disabled)).toBe(true);

      await act(async () => {
        player?.options.events.onReady();
      });
      expect(buttonsNamed(view.container, "Play clip").some((button) => button.disabled)).toBe(false);
      expect(document.querySelector(`script[src="${iframeApi}"]`)).toBeNull();
      const [stored] = await listUserLessons();
      expect(stored).toMatchObject({
        videoId: "dQw4w9WgXcQ",
        sentences: [
          { text: "I like green tea.", cue: { start: 0, end: 2 } },
          { text: "Do you like it?", cue: { start: 2, end: 65 } },
          { text: "We drink it every morning.", cue: { start: 65, end: null } },
        ],
      });
      await unmount(view);
    });

    it.each([
      ["a bad URL", "https://vimeo.com/1", transcript, "Enter a YouTube video URL."],
      ["leading text", "https://youtu.be/dQw4w9WgXcQ", `Hi\n${transcript}`, "The transcript must start with a timestamp."],
      ["non-increasing timestamps", "https://youtu.be/dQw4w9WgXcQ", "0:05\nOne.\n0:05\nTwo.", "Timestamps must increase"],
    ])("shows an inline error and stores nothing for %s", async (_name, videoUrl, text, message) => {
      installYouTube();
      const view = await renderApp();
      await createLesson(view.container, videoUrl, text);

      expect(view.container.textContent).toContain(message);
      expect(view.container.textContent).not.toContain("Back to lessons");
      expect(await listUserLessons()).toEqual([]);
      expect(FakePlayer.instances).toEqual([]);
      await unmount(view);
    });

    it("plays a clip at the chosen speed and pauses when the time passes the cue end", async () => {
      const { view, player } = await openVideoLesson();
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      await act(async () => {
        buttonsNamed(view.container, "0.75x")[0]?.click();
      });
      await act(async () => {
        buttonsNamed(view.container, "Play clip")[1]?.click();
      });
      expect(player.calls).toEqual([["setPlaybackRate", 0.75], ["seekTo", 2, true], ["playVideo"]]);

      player.time = 64.9;
      vi.advanceTimersByTime(100);
      expect(player.calls).not.toContainEqual(["pauseVideo"]);
      player.time = 65;
      vi.advanceTimersByTime(100);
      expect(player.calls.filter(([name]) => name === "pauseVideo")).toHaveLength(1);
      vi.advanceTimersByTime(1000);
      expect(player.calls.filter(([name]) => name === "pauseVideo")).toHaveLength(1);

      player.calls = [];
      await act(async () => {
        buttonsNamed(view.container, "Play clip")[2]?.click();
      });
      expect(player.calls).toEqual([["setPlaybackRate", 0.75], ["seekTo", 65, true], ["playVideo"]]);
      expect(vi.getTimerCount()).toBe(0);
      await unmount(view);
    });

    it("cancels the older clip's poll when a newer clip starts", async () => {
      const { view, player } = await openVideoLesson();
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      await act(async () => {
        buttonsNamed(view.container, "Play clip")[0]?.click();
      });
      await act(async () => {
        buttonsNamed(view.container, "Play clip")[1]?.click();
      });
      expect(vi.getTimerCount()).toBe(1);

      player.time = 3;
      vi.advanceTimersByTime(500);
      expect(player.calls).not.toContainEqual(["pauseVideo"]);
      await unmount(view);
    });

    it("destroys the player and cancels the poll on unmount", async () => {
      const { view, player } = await openVideoLesson();
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      await act(async () => {
        buttonsNamed(view.container, "Play clip")[0]?.click();
      });
      await act(async () => {
        buttonsNamed(view.container, "Back to lessons")[0]?.click();
      });

      expect(player.calls.filter(([name]) => name === "destroy")).toHaveLength(1);
      expect(view.container.contains(player.element)).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
      player.time = 100;
      vi.advanceTimersByTime(500);
      expect(player.calls).not.toContainEqual(["pauseVideo"]);
      await unmount(view);
    });

    it("offers Play clip in the dictation and fill-the-blank modes", async () => {
      const { view, player } = await openVideoLesson();
      for (const mode of ["Dictation", "Fill the blank"]) {
        await act(async () => {
          buttonsNamed(view.container, mode)[0]?.click();
        });
        expect(buttonsNamed(view.container, "Play clip")).toHaveLength(3);
        player.calls = [];
        await act(async () => {
          buttonsNamed(view.container, "Play clip")[0]?.click();
        });
        expect(player.calls).toEqual([["setPlaybackRate", 1], ["seekTo", 0, true], ["playVideo"]]);
      }
      expect(FakePlayer.instances).toHaveLength(1);
      await unmount(view);
    });

    it("creates no player and injects no script for a plain lesson", async () => {
      const view = await renderApp();
      const titleInput = view.container.querySelector<HTMLInputElement>("#import-title");
      const textArea = view.container.querySelector<HTMLTextAreaElement>("#import-text");
      if (!titleInput || !textArea) throw new Error("import form not found");
      await act(async () => {
        setInputValue(titleInput, "Tea talk");
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(textArea, "I like tea.");
        textArea.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => {
        titleInput.form?.requestSubmit();
      });
      await waitForCondition(() => view.container.textContent?.includes("Back to lessons") ?? false);

      expect(document.querySelector(`script[src="${iframeApi}"]`)).toBeNull();
      expect(window.onYouTubeIframeAPIReady).toBeUndefined();
      expect(buttonsNamed(view.container, "Play clip")).toEqual([]);
      expect(view.container.textContent).not.toContain("Video from YouTube");
      await unmount(view);
    });

    class ClipRecognition {
      static instances: ClipRecognition[] = [];
      lang = "";
      continuous = true;
      interimResults = true;
      maxAlternatives = 5;
      onresult: ((event: { results: { transcript: string }[][] }) => void) | null = null;
      onerror: ((event: { error: string }) => void) | null = null;
      onend: (() => void) | null = null;
      start = vi.fn();
      abort = vi.fn();
      constructor() {
        ClipRecognition.instances.push(this);
      }
    }

    async function openVideoLessonWithCheck() {
      localStorage.setItem("road-to-english.pronunciationCheck", "on");
      ClipRecognition.instances = [];
      vi.stubGlobal("webkitSpeechRecognition", ClipRecognition);
      const opened = await openVideoLesson();
      localStorage.removeItem("road-to-english.pronunciationCheck");
      return opened;
    }

    it("pauses the playing clip and clears its poll when a pronunciation check starts", async () => {
      const { view, player } = await openVideoLessonWithCheck();
      vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
      await act(async () => {
        buttonsNamed(view.container, "Play clip")[0]?.click();
      });
      expect(player.calls).toContainEqual(["playVideo"]);
      player.calls = [];
      await act(async () => {
        buttonsNamed(view.container, "Check pronunciation")[0]?.click();
      });
      expect(player.calls).toEqual([["pauseVideo"]]);
      expect(ClipRecognition.instances).toHaveLength(1);
      player.time = 10;
      vi.advanceTimersByTime(1000);
      expect(player.calls).toEqual([["pauseVideo"]]);
      await unmount(view);
    });

    it("aborts a listening check silently when Play clip starts", async () => {
      const { view, player } = await openVideoLessonWithCheck();
      await act(async () => {
        buttonsNamed(view.container, "Check pronunciation")[0]?.click();
      });
      const recognition = ClipRecognition.instances.at(-1)!;
      expect(buttonsNamed(view.container, "Listening…")).toHaveLength(1);
      player.calls = [];
      await act(async () => {
        buttonsNamed(view.container, "Play clip")[0]?.click();
      });
      expect(recognition.abort).toHaveBeenCalledOnce();
      expect(buttonsNamed(view.container, "Listening…")).toHaveLength(0);
      expect(buttonsNamed(view.container, "Check pronunciation")).toHaveLength(3);
      expect(buttonsNamed(view.container, "Try again")).toHaveLength(0);
      expect(view.container.textContent).not.toContain("aborted");
      expect(player.calls).toEqual([["setPlaybackRate", 1], ["seekTo", 0, true], ["playVideo"]]);
      await unmount(view);
    });

    // The stub fires the script's error event instead of letting happy-dom try the network, the same path as a blocked or offline load.
    it("loads the API script once and shows the couldn't-load line when it fails, keeping the lesson usable", async () => {
      const append = vi.spyOn(document.head, "append").mockImplementation((...nodes) => {
        for (const node of nodes) {
          setTimeout(() => (node as HTMLScriptElement).dispatchEvent(new Event("error")), 0);
        }
      });
      const view = await renderApp();
      await createLesson(view.container, "https://youtu.be/dQw4w9WgXcQ", transcript);
      await waitForCondition(() => view.container.textContent?.includes("Back to lessons") ?? false);

      await waitForCondition(
        () => view.container.textContent?.includes("The video couldn't load. You can keep practising with Listen.") ?? false,
      );
      expect(view.container.textContent).not.toContain("Loading video…");
      expect(append.mock.calls.map(([node]) => (node as HTMLScriptElement).src)).toEqual([iframeApi]);
      expect(document.querySelector(`script[src="${iframeApi}"]`)).toBeNull();
      expect(buttonsNamed(view.container, "Play clip").every((button) => button.disabled)).toBe(true);
      await act(async () => {
        buttonsNamed(view.container, "Dictation")[0]?.click();
      });
      expect(view.container.querySelector("#dictation-s1")).not.toBeNull();
      await unmount(view);
    });

    it("sizes the player to fill a 16:9 column and shows Loading video… until ready", async () => {
      installYouTube();
      const view = await renderApp();
      await createLesson(view.container, "https://youtu.be/dQw4w9WgXcQ", transcript);
      await waitForCondition(() => FakePlayer.instances.length === 1);
      const player = FakePlayer.instances[0]!;
      expect(player.options).toMatchObject({ width: "100%", height: "100%" });
      expect(view.container.textContent).toContain("Loading video…");
      await act(async () => {
        player.options.events.onReady();
      });
      expect(view.container.textContent).not.toContain("Loading video…");
      await unmount(view);
    });

    it("shows the couldn't-load line when the player is not ready after 15 s, keeps the lesson usable, and accepts a late ready", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"], shouldAdvanceTime: true });
      installYouTube();
      installSpeechFakes();
      const view = await renderApp();
      await createLesson(view.container, "https://youtu.be/dQw4w9WgXcQ", transcript);
      await waitForCondition(() => FakePlayer.instances.length === 1);
      const player = FakePlayer.instances[0]!;
      const failed = "The video couldn't load. You can keep practising with Listen.";

      await act(async () => {
        vi.advanceTimersByTime(14_000);
      });
      expect(view.container.textContent).toContain("Loading video…");
      expect(view.container.textContent).not.toContain(failed);
      await act(async () => {
        vi.advanceTimersByTime(1_100);
      });
      expect(view.container.textContent).toContain(failed);
      expect(view.container.textContent).not.toContain("Loading video…");
      expect(buttonsNamed(view.container, "Listen")[0]?.disabled).toBe(false);

      await act(async () => {
        player.options.events.onReady();
      });
      expect(view.container.textContent).not.toContain(failed);
      expect(buttonsNamed(view.container, "Play clip").every((button) => !button.disabled)).toBe(true);
      await unmount(view);
    });

    it("stops speech and the loop when the video starts playing, and Listen pauses the video", async () => {
      const speech = installSpeechFakes();
      const { view, player } = await openVideoLesson();
      await act(async () => {
        buttonsNamed(view.container, "Loop")[0]?.click();
      });
      expect(player.calls).toContainEqual(["pauseVideo"]);
      await act(async () => {
        speech.spoken.at(-1)?.onboundary?.({ name: "word", charIndex: 0 });
      });
      expect(view.container.querySelectorAll('[aria-current="true"]')).toHaveLength(1);
      speech.cancel.mockClear();

      // The player's own controls start playback: YT.PlayerState.PLAYING.
      await act(async () => {
        player.options.events.onStateChange({ data: 1 });
      });
      expect(speech.cancel).toHaveBeenCalled();
      expect(buttonsNamed(view.container, "Loop")[0]?.getAttribute("aria-pressed")).toBe("false");
      expect(view.container.querySelectorAll('[aria-current="true"]')).toHaveLength(0);
      const spoken = speech.spoken.length;
      await act(async () => {
        speech.finish();
      });
      expect(speech.spoken).toHaveLength(spoken);

      player.calls = [];
      await act(async () => {
        buttonsNamed(view.container, "Listen")[1]?.click();
      });
      expect(player.calls).toEqual([["pauseVideo"]]);
      await unmount(view);
    });
  });

  describe("pronunciation check", () => {
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

    const hasText = (container: HTMLElement, text: string) => () =>
      container.textContent?.includes(text) ?? false;

    async function openShadow() {
      installSpeechFakes();
      FakeRecognition.instances = [];
      vi.stubGlobal("webkitSpeechRecognition", FakeRecognition);
      return openLesson();
    }

    async function close({ container, root }: { container: HTMLElement; root: ReturnType<typeof createRoot> }) {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }

    async function click(container: HTMLElement, name: string) {
      await act(async () => {
        buttonsNamed(container, name)[0]?.click();
      });
    }

    async function enable(container: HTMLElement) {
      await click(container, "Pronunciation check");
      await click(container, "Enable");
    }

    async function checkFirstSentence(container: HTMLElement) {
      await click(container, "Check pronunciation");
      const recognition = FakeRecognition.instances.at(-1);
      if (!recognition) throw new Error("recognition not started");
      return recognition;
    }

    afterEach(() => {
      localStorage.clear();
    });

    it("is off by default with no Check buttons", async () => {
      const view = await openShadow();
      expect(buttonsNamed(view.container, "Pronunciation check")).toHaveLength(1);
      expect(buttonsNamed(view.container, "Check pronunciation")).toHaveLength(0);
      expect(localStorage.getItem("road-to-english.pronunciationCheck")).toBeNull();
      await close(view);
    });

    it("shows the disclosure first, keeps it off on Cancel, and persists Enable", async () => {
      const view = await openShadow();
      await click(view.container, "Pronunciation check");
      expect(view.container.textContent).toContain("speech recognition");
      expect(view.container.textContent).toContain("sent to Google's servers");
      expect(view.container.textContent).toContain("Nothing is sent to road-to-english.");
      expect(localStorage.getItem("road-to-english.pronunciationCheck")).toBeNull();
      expect(buttonsNamed(view.container, "Check pronunciation")).toHaveLength(0);

      await click(view.container, "Cancel");
      expect(view.container.textContent).not.toContain("Nothing is sent to road-to-english.");
      expect(localStorage.getItem("road-to-english.pronunciationCheck")).toBeNull();
      expect(buttonsNamed(view.container, "Check pronunciation")).toHaveLength(0);

      await enable(view.container);
      expect(localStorage.getItem("road-to-english.pronunciationCheck")).toBe("on");
      expect(buttonsNamed(view.container, "Check pronunciation")).toHaveLength(3);
      await close(view);

      const remounted = await openShadow();
      expect(buttonsNamed(remounted.container, "Check pronunciation")).toHaveLength(3);
      await close(remounted);
    });

    it("shows what was said, the diff, and counts one practice", async () => {
      const view = await openShadow();
      await waitForCondition(hasText(view.container, "Goal 0/10"));
      await enable(view.container);
      await click(view.container, "Loop");
      expect(buttonsNamed(view.container, "Loop")[0]?.getAttribute("aria-pressed")).toBe("true");
      const recognition = await checkFirstSentence(view.container);
      expect(buttonsNamed(view.container, "Loop")[0]?.getAttribute("aria-pressed")).toBe("false");
      expect(recognition.processLocally).toBe(true);
      expect(buttonsNamed(view.container, "Listening…")[0]?.getAttribute("aria-disabled")).toBe("true");

      await act(async () => {
        recognition.onresult?.({ results: [[{ transcript: "good morning how are you today" }]] });
        recognition.onend?.();
      });
      expect(view.container.textContent).toContain("You said: good morning how are you today");
      expect(view.container.textContent).toContain("Correct");
      await waitForCondition(hasText(view.container, "Goal 1/10"));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(view.container.textContent).toContain("Goal 1/10");

      await click(view.container, "Try again");
      expect(view.container.textContent).not.toContain("You said:");
      await close(view);
    });

    it("labels a wrong word with what was said", async () => {
      const view = await openShadow();
      await enable(view.container);
      const recognition = await checkFirstSentence(view.container);
      await act(async () => {
        recognition.onresult?.({ results: [[{ transcript: "good morning how are you tomorrow" }]] });
      });
      expect(view.container.textContent).toContain('today (you said "tomorrow")');
      expect(view.container.textContent).toContain("Not quite");
      await close(view);
    });

    it("shows a recognition error", async () => {
      const view = await openShadow();
      await enable(view.container);
      const recognition = await checkFirstSentence(view.container);
      await act(async () => {
        recognition.onerror?.({ error: "language-not-supported" });
        recognition.onend?.();
      });
      expect(view.container.textContent).toContain(
        "On-device English recognition isn't available in this browser. Use Record and Compare to check yourself.",
      );
      expect(FakeRecognition.instances).toHaveLength(1);
      await click(view.container, "Try again");
      expect(view.container.textContent).not.toContain("On-device English recognition");
      await close(view);
    });

    it("disables the toggle with a reason when recognition is unsupported", async () => {
      localStorage.setItem("road-to-english.pronunciationCheck", "on");
      installSpeechFakes();
      const view = await openLesson();
      expect(buttonsNamed(view.container, "Pronunciation check")[0]?.disabled).toBe(true);
      expect(view.container.textContent).toContain(
        "Pronunciation check disabled: speech recognition is not supported in this browser.",
      );
      expect(buttonsNamed(view.container, "Check pronunciation")).toHaveLength(0);
      await close(view);
    });

    it("hides the Check buttons and aborts listening when turned off", async () => {
      const view = await openShadow();
      await enable(view.container);
      const recognition = await checkFirstSentence(view.container);
      await click(view.container, "Pronunciation check");
      expect(buttonsNamed(view.container, "Check pronunciation")).toHaveLength(0);
      expect(buttonsNamed(view.container, "Listening…")).toHaveLength(0);
      expect(recognition.abort).toHaveBeenCalled();
      expect(localStorage.getItem("road-to-english.pronunciationCheck")).toBeNull();
      await close(view);
    });

    it("resets the first sentence without a message when another sentence starts a check", async () => {
      const view = await openShadow();
      await enable(view.container);
      const first = await checkFirstSentence(view.container);
      await act(async () => {
        buttonsNamed(view.container, "Check pronunciation")[0]?.click();
      });
      expect(first.abort).toHaveBeenCalled();
      expect(FakeRecognition.instances).toHaveLength(2);
      expect(buttonsNamed(view.container, "Listening…")).toHaveLength(1);
      expect(buttonsNamed(view.container, "Check pronunciation")).toHaveLength(2);
      expect(view.container.textContent).not.toContain("aborted");
      expect(buttonsNamed(view.container, "Try again")).toHaveLength(0);
      await close(view);
    });

    it("disables Listen, Loop and Compare in the listening sentence and stops speech", async () => {
      installMediaDevices(async () => ({ getTracks: () => [{ stop: vi.fn() }] }) as unknown as MediaStream);
      installObjectUrlFakes();
      vi.stubGlobal(
        "MediaRecorder",
        class {
          state = "inactive";
          mimeType = "audio/webm";
          ondataavailable: ((event: BlobEvent) => void) | null = null;
          onstop: (() => void) | null = null;
          start() {
            this.state = "recording";
          }
          stop() {
            this.state = "inactive";
            this.ondataavailable?.({ data: new Blob(["audio"]) } as BlobEvent);
            this.onstop?.();
          }
        },
      );
      const view = await openShadow();
      await enable(view.container);
      await click(view.container, "Record");
      await click(view.container, "Stop");
      expect(buttonsNamed(view.container, "Compare")[0]?.disabled).toBe(false);
      expect(buttonsNamed(view.container, "Listen")[0]?.disabled).toBe(false);
      expect(buttonsNamed(view.container, "Loop")[0]?.disabled).toBe(false);
      const speech = window.speechSynthesis as unknown as { cancel: ReturnType<typeof vi.fn> };
      speech.cancel.mockClear();
      await checkFirstSentence(view.container);
      expect(speech.cancel).toHaveBeenCalled();
      expect(buttonsNamed(view.container, "Listen")[0]?.disabled).toBe(true);
      expect(buttonsNamed(view.container, "Loop")[0]?.disabled).toBe(true);
      expect(buttonsNamed(view.container, "Compare")[0]?.disabled).toBe(true);
      expect(buttonsNamed(view.container, "Listen")[1]?.disabled).toBe(false);
      expect(buttonsNamed(view.container, "Loop")[1]?.disabled).toBe(false);
      await close(view);
    });

    it.each([
      ["result", (recognition: FakeRecognition) =>
        recognition.onresult?.({ results: [[{ transcript: "good morning how are you today" }]] })],
      ["error", (recognition: FakeRecognition) => recognition.onerror?.({ error: "network" })],
    ])("ignores a late %s from a recognition dropped by turning the setting off", async (_name, settle) => {
      const view = await openShadow();
      await waitForCondition(hasText(view.container, "Goal 0/10"));
      await enable(view.container);
      const recognition = await checkFirstSentence(view.container);
      // The recognition settles before the toggle, but its handler runs only after
      // the toggle's cleanup has dropped this recognition.
      settle(recognition);
      act(() => {
        buttonsNamed(view.container, "Pronunciation check")[0]?.click();
      });
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(view.container.textContent).not.toContain("You said:");
      expect(view.container.textContent).not.toContain("Speech recognition couldn't reach its service.");
      expect(view.container.textContent).toContain("Goal 0/10");
      await close(view);
    });

    it("keeps dictation wording as you typed with the setting on", async () => {
      const view = await openShadow();
      await enable(view.container);
      await click(view.container, "Dictation");
      const input = view.container.querySelector<HTMLInputElement>(
        `#dictation-${greetingsLesson.sentences[0].id}`,
      );
      if (!input) throw new Error("dictation input not found");
      await act(async () => {
        setInputValue(input, "Good morning, how are you tomorrow?");
        input.form?.requestSubmit();
      });
      expect(view.container.textContent).toContain("You typed: Good morning, how are you tomorrow?");
      expect(view.container.textContent).toContain('today (you typed "tomorrow")');
      expect(buttonsNamed(view.container, "Check pronunciation")).toHaveLength(0);
      await close(view);
    });
  });

  describe("practice robustness", () => {
    class Recognition {
      static instances: Recognition[] = [];
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
        Recognition.instances.push(this);
      }
    }

    class Recorder {
      static instances: Recorder[] = [];
      state = "inactive";
      mimeType = "audio/webm";
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onstop: (() => void) | null = null;
      constructor() {
        Recorder.instances.push(this);
      }
      start() {
        this.state = "recording";
      }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["audio"]) } as BlobEvent);
        this.onstop?.();
      }
    }

    // Speech, recognition (with the check on) and recording, all faked.
    async function openPractice(lesson = greetingsLesson) {
      const speech = installSpeechFakes();
      Recognition.instances = [];
      Recorder.instances = [];
      vi.stubGlobal("webkitSpeechRecognition", Recognition);
      installMediaDevices(async () => ({ getTracks: () => [{ stop: vi.fn() }] }) as unknown as MediaStream);
      installObjectUrlFakes();
      vi.stubGlobal("MediaRecorder", Recorder);
      localStorage.setItem("road-to-english.pronunciationCheck", "on");
      const view = await openLesson(lesson);
      localStorage.removeItem("road-to-english.pronunciationCheck");
      return { ...view, speech };
    }

    async function close({ container, root }: { container: HTMLElement; root: ReturnType<typeof createRoot> }) {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }

    async function click(container: HTMLElement, name: string, index = 0) {
      await act(async () => {
        buttonsNamed(container, name)[index]?.click();
      });
    }

    const spokenWords = (container: HTMLElement) =>
      Array.from(container.querySelectorAll('[aria-current="true"]')).map((element) => element.textContent);

    const settle = () =>
      act(async () => {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
      });

    afterEach(() => {
      localStorage.clear();
    });

    it("runs one practice medium at a time across sentences", async () => {
      const view = await openPractice();
      const { container, speech } = view;

      await click(container, "Listen");
      await click(container, "Check pronunciation");
      const firstCheck = Recognition.instances.at(-1)!;
      expect(speech.cancel).toHaveBeenCalled();

      // Record in sentence 2 stops the check in sentence 1 and any speech.
      speech.cancel.mockClear();
      await click(container, "Record", 1);
      await waitForCondition(() => buttonsNamed(container, "Stop").length === 1);
      expect(firstCheck.abort).toHaveBeenCalledOnce();
      expect(buttonsNamed(container, "Listening…")).toHaveLength(0);
      expect(speech.cancel).toHaveBeenCalled();

      // Check in sentence 1 stops the recording in sentence 2.
      await click(container, "Check pronunciation");
      expect(Recorder.instances[0]?.state).toBe("inactive");
      expect(buttonsNamed(container, "Stop")).toHaveLength(0);
      expect(container.querySelectorAll("audio")).toHaveLength(1);
      const secondCheck = Recognition.instances.at(-1)!;

      // Listen in sentence 3 stops the check in sentence 1.
      await click(container, "Listen", 2);
      expect(secondCheck.abort).toHaveBeenCalledOnce();
      expect(speech.spoken.at(-1)?.text).toBe(greetingsLesson.sentences[2].text);

      // Record stops a Loop in another sentence; Listen stops a recording.
      await click(container, "Loop");
      expect(buttonsNamed(container, "Loop")[0]?.getAttribute("aria-pressed")).toBe("true");
      speech.cancel.mockClear();
      await click(container, "Record", 2);
      await waitForCondition(() => buttonsNamed(container, "Stop").length === 1);
      expect(buttonsNamed(container, "Loop")[0]?.getAttribute("aria-pressed")).toBe("false");
      expect(speech.cancel).toHaveBeenCalled();
      await click(container, "Listen", 1);
      expect(Recorder.instances.at(-1)?.state).toBe("inactive");
      expect(buttonsNamed(container, "Stop")).toHaveLength(0);
      await close(view);
    });

    it("pauses Compare's recording when Listen starts in another sentence", async () => {
      const view = await openPractice();
      const { container, speech } = view;
      const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
      const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});

      await click(container, "Record");
      await waitForCondition(() => buttonsNamed(container, "Stop").length === 1);
      await click(container, "Stop");
      await click(container, "Compare");
      await act(async () => {
        speech.finish();
        speech.spoken.at(-1)?.onend?.();
      });
      expect(play).toHaveBeenCalledOnce();
      pause.mockClear();

      await click(container, "Listen", 1);
      expect(pause).toHaveBeenCalled();
      await close(view);
    });

    it("stops speech and Loop when the recording plays from its own controls", async () => {
      const view = await openPractice();
      const { container, speech } = view;
      const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});

      await click(container, "Record");
      await waitForCondition(() => buttonsNamed(container, "Stop").length === 1);
      await click(container, "Stop");
      await click(container, "Loop", 1);
      expect(buttonsNamed(container, "Loop")[1]?.getAttribute("aria-pressed")).toBe("true");
      speech.cancel.mockClear();
      pause.mockClear();

      await act(async () => {
        container.querySelector("audio")?.dispatchEvent(new Event("play"));
      });
      expect(buttonsNamed(container, "Loop")[1]?.getAttribute("aria-pressed")).toBe("false");
      expect(speech.cancel).toHaveBeenCalled();
      expect(pause).not.toHaveBeenCalled();
      await close(view);
    });

    it("turns Loop off on a speech error, plays the recording after a failed Compare reference, and explains a failed Listen once", async () => {
      const view = await openPractice();
      const { container, speech } = view;
      const message = "Couldn't play the sentence. Check your browser's speech settings.";
      const occurrences = () => container.textContent?.split(message).length ?? 1;
      const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);

      await click(container, "Loop");
      await act(async () => {
        speech.spoken.at(-1)?.onerror?.({ error: "synthesis-failed" });
      });
      expect(buttonsNamed(container, "Loop")[0]?.getAttribute("aria-pressed")).toBe("false");
      const spoken = speech.spoken.length;
      await act(async () => {
        speech.finish();
        speech.spoken.at(-1)?.onend?.();
      });
      expect(speech.spoken).toHaveLength(spoken);

      await click(container, "Listen");
      expect(container.textContent).not.toContain(message);
      await act(async () => {
        speech.spoken.at(-1)?.onboundary?.({ name: "word", charIndex: 0 });
      });
      expect(spokenWords(container)).toEqual(["Good"]);
      await act(async () => {
        speech.spoken.at(-1)?.onerror?.({ error: "synthesis-failed" });
        speech.spoken.at(-1)?.onerror?.({ error: "synthesis-failed" });
      });
      expect(occurrences()).toBe(2);
      expect(spokenWords(container)).toEqual([]);

      // Our own supersede is silent.
      await click(container, "Listen", 1);
      const superseded = speech.spoken.at(-1);
      await click(container, "Listen", 2);
      await act(async () => {
        superseded?.onerror?.({ error: "interrupted" });
      });
      expect(container.textContent?.split(message).length).toBe(2);
      expect(buttonsNamed(container, "Listen").map((_, index) => index)).toHaveLength(3);

      await click(container, "Record");
      await waitForCondition(() => buttonsNamed(container, "Stop").length === 1);
      await click(container, "Stop");
      await click(container, "Compare");
      expect(play).not.toHaveBeenCalled();
      await act(async () => {
        speech.spoken.at(-1)?.onerror?.({ error: "audio-busy" });
      });
      expect(play).toHaveBeenCalledOnce();
      await close(view);
    });

    it("clears the spoken-word highlight when another medium starts or the sentence is left", async () => {
      const view = await openPractice();
      const { container, speech } = view;
      const highlight = async () => {
        await click(container, "Listen");
        await act(async () => {
          speech.spoken.at(-1)?.onboundary?.({ name: "word", charIndex: 0 });
        });
        expect(spokenWords(container)).toEqual(["Good"]);
      };

      await highlight();
      await click(container, "Record", 1);
      await waitForCondition(() => buttonsNamed(container, "Stop").length === 1);
      expect(spokenWords(container)).toEqual([]);

      await highlight();
      await click(container, "Check pronunciation", 2);
      expect(spokenWords(container)).toEqual([]);

      await highlight();
      await click(container, "morning");
      await click(container, "Hear word");
      expect(spokenWords(container)).toEqual([]);

      await highlight();
      await click(container, "Dictation");
      await click(container, "Shadow");
      expect(spokenWords(container)).toEqual([]);
      await close(view);
    });

    it("counts each non-empty sentence check once per lesson visit", async () => {
      const view = await openPractice();
      const { container } = view;
      const first = greetingsLesson.sentences[0];
      await waitForCondition(() => container.textContent?.includes("Goal 0/10") ?? false);
      const submit = async (selector: string, value: string) => {
        const input = container.querySelector<HTMLInputElement>(selector);
        if (!input) throw new Error(`${selector} not found`);
        await act(async () => {
          setInputValue(input, value);
          input.form?.requestSubmit();
        });
        await settle();
      };
      const goal = (count: number) => expect(container.textContent).toContain(`Goal ${count}/10`);

      await click(container, "Check pronunciation");
      await act(async () => {
        Recognition.instances.at(-1)?.onresult?.({ results: [[{ transcript: "  " }]] });
      });
      await settle();
      goal(0);
      await click(container, "Try again");
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await click(container, "Check pronunciation");
        await act(async () => {
          Recognition.instances.at(-1)?.onresult?.({ results: [[{ transcript: "good morning" }]] });
        });
        await settle();
        goal(1);
        await click(container, "Try again");
      }

      for (let attempt = 0; attempt < 2; attempt += 1) {
        await click(container, "Record");
        await waitForCondition(() => buttonsNamed(container, "Stop").length === 1);
        await click(container, "Stop");
        await settle();
        goal(2);
      }

      await click(container, "Dictation");
      await submit(`#dictation-${first.id}`, "   ");
      goal(2);
      await submit(`#dictation-${first.id}`, "good morning");
      goal(3);
      await click(container, "Try again");
      await submit(`#dictation-${first.id}`, first.text);
      goal(3);

      await click(container, "Fill the blank");
      await submit(`#blank-${first.id}`, "");
      goal(3);
      await submit(`#blank-${first.id}`, "evening");
      goal(4);
      await click(container, "Try again");
      await submit(`#blank-${first.id}`, "morning");
      goal(4);
      await close(view);
    });

    it("looks up and links a word with its apostrophe but saves the normalised word", async () => {
      const lesson = {
        ...greetingsLesson,
        sentences: [{ ...greetingsLesson.sentences[0], text: "Don’t worry about it." }, ...greetingsLesson.sentences.slice(1)],
      };
      const view = await openPractice(lesson);
      const { container } = view;
      const api = fetchMock.getMockImplementation()!;
      const dictionaryUrls: string[] = [];
      fetchMock.mockImplementation(async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.startsWith("https://api.dictionaryapi.dev/")) {
          dictionaryUrls.push(url);
          return new Response("[]", { status: 404 });
        }
        return api(input, init);
      });

      await click(container, "Don’t");
      await click(container, "Define");
      await waitForCondition(() => container.textContent?.includes("No definition") ?? false);
      expect(dictionaryUrls).toEqual(["https://api.dictionaryapi.dev/api/v2/entries/en/don't"]);
      const link = Array.from(container.querySelectorAll("a")).find((anchor) => anchor.textContent === "Hear it on YouGlish");
      expect(link?.getAttribute("href")).toBe("https://youglish.com/pronounce/don't/english");

      await click(container, "Save word");
      await waitForCondition(() => buttonsNamed(container, "Saved").length === 1);
      const [card] = await getAllCards();
      expect(card?.source.word).toBe("dont");
      await close(view);
    });

    it("looks up and links a word without its surrounding quote marks", async () => {
      const lesson = {
        ...greetingsLesson,
        sentences: [
          { ...greetingsLesson.sentences[0], text: "She said 'hello' to the students' teacher." },
          ...greetingsLesson.sentences.slice(1),
        ],
      };
      const view = await openPractice(lesson);
      const { container } = view;
      const api = fetchMock.getMockImplementation()!;
      const dictionaryUrls: string[] = [];
      fetchMock.mockImplementation(async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.startsWith("https://api.dictionaryapi.dev/")) {
          dictionaryUrls.push(url);
          return new Response("[]", { status: 404 });
        }
        return api(input, init);
      });
      const youglish = () =>
        Array.from(container.querySelectorAll("a")).find((anchor) => anchor.textContent === "Hear it on YouGlish");

      for (const [token, word] of [["'hello'", "hello"], ["students'", "students"]]) {
        await click(container, token);
        await click(container, "Define");
        await waitForCondition(() => dictionaryUrls.length > 0);
        expect(dictionaryUrls.splice(0)).toEqual([`https://api.dictionaryapi.dev/api/v2/entries/en/${word}`]);
        expect(youglish()?.getAttribute("href")).toBe(`https://youglish.com/pronounce/${word}/english`);
      }
      await close(view);
    });

    it("says the dictionary is unreachable on a network failure", async () => {
      const view = await openPractice();
      const { container } = view;
      const api = fetchMock.getMockImplementation()!;
      fetchMock.mockImplementation(async (input, init) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        if (url.startsWith("https://api.dictionaryapi.dev/")) {
          throw new TypeError("Failed to fetch");
        }
        return api(input, init);
      });
      await click(container, "morning");
      await click(container, "Define");
      await waitForCondition(
        () => container.textContent?.includes("Couldn't reach the dictionary. Check your connection.") ?? false,
      );
      expect(container.textContent).not.toContain("No definition");
      await close(view);
    });

    it("turns off autocomplete, autocorrect, autocapitalise and spellcheck on the answer inputs", async () => {
      const view = await openPractice();
      const { container } = view;
      const id = greetingsLesson.sentences[0].id;
      for (const [mode, selector] of [["Dictation", `#dictation-${id}`], ["Fill the blank", `#blank-${id}`]]) {
        await click(container, mode);
        const input = container.querySelector<HTMLInputElement>(selector);
        expect(input?.getAttribute("autocomplete")).toBe("off");
        expect(input?.getAttribute("autocorrect")).toBe("off");
        expect(input?.getAttribute("autocapitalize")).toBe("off");
        expect(input?.getAttribute("spellcheck")).toBe("false");
      }
      await close(view);
    });

    it("plays dictation and blank sentences at the selected speed", async () => {
      const view = await openPractice();
      const { container, speech } = view;
      await click(container, "0.5x");
      for (const mode of ["Dictation", "Fill the blank"]) {
        await click(container, mode);
        await click(container, "Play");
        // 90 WPM is rate 0.5, halved by the 0.5x speed.
        expect(speech.spoken.at(-1)?.rate).toBe(0.25);
      }
      await close(view);
    });
  });

  describe("storage failures, retry, and dead ends", () => {
    const storageLine = "Your saved data couldn't be read or saved on this device";

    async function renderApp(route: (path: string) => Response | Promise<Response> = (path) => responseFor(path)) {
      fetchMock.mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        return route(new URL(url, "http://localhost").pathname);
      });
      vi.stubGlobal("fetch", fetchMock);
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      await act(async () => {
        root.render(
          <StrictMode>
            <App />
          </StrictMode>,
        );
      });
      const unmount = async () => {
        await act(async () => {
          root.unmount();
        });
        container.remove();
      };
      return { container, unmount };
    }

    const hasText = (container: HTMLElement, text: string) => () =>
      container.textContent?.includes(text) ?? false;

    async function click(container: HTMLElement, name: string, index = 0) {
      const button = buttonsNamed(container, name)[index];
      if (!button) throw new Error(`${name} button not found`);
      await act(async () => {
        button.click();
      });
      return button;
    }

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
      const { container, unmount } = await renderApp();
      await waitForCondition(hasText(container, storageLine));
      expect(container.textContent).toContain(`${storageLine}: IndexedDB is unavailable. Reload to try again.`);

      await click(container, "Review");
      expect(container.textContent).not.toContain("Loading review deck...");
      expect(container.textContent).toContain("Your review deck couldn't be loaded.");
      expect(container.textContent).not.toContain("Nothing to review yet");
      await unmount();
    });

    it("shows the storage line when progress fails to load", async () => {
      vi.spyOn(progressStore, "getPracticeDays").mockRejectedValue(new Error("progress store broke"));
      const { container, unmount } = await renderApp();
      await waitForCondition(hasText(container, `${storageLine}: progress store broke.`));
      expect(container.textContent).toContain("Greetings & Basics");
      await unmount();
    });

    it("shows an error instead of loading forever when your lessons fail to load", async () => {
      vi.spyOn(userLessonsStore, "listUserLessons").mockRejectedValue(new Error("lessons store broke"));
      const { container, unmount } = await renderApp();
      await waitForCondition(hasText(container, "Unable to load your lessons: lessons store broke"));
      expect(container.textContent).not.toContain("Loading your lessons...");
      expect(container.textContent).toContain(`${storageLine}: lessons store broke.`);
      await unmount();
    });

    it("recovers Save to review and Save word after a failed write", async () => {
      installSpeechFakes();
      const { container, unmount } = await renderApp();
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
      await unmount();
    });

    it("recovers rating in Review after a failed write", async () => {
      await putCard(
        createCard({ front: "front", back: "back", source: { lessonId: "l", sentenceId: "s", word: "" } }, new Date()),
      );
      const { container, unmount } = await renderApp();
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
      await unmount();
    });

    it("reports a failed progress write after a saved rating in the header, not as a rating failure", async () => {
      await putCard(
        createCard({ front: "front", back: "back", source: { lessonId: "l", sentenceId: "s", word: "" } }, new Date()),
      );
      const { container, unmount } = await renderApp();
      await click(container, "Review");
      await waitForCondition(() => buttonsNamed(container, "Show answer").length === 1);
      await click(container, "Show answer");
      vi.spyOn(progressStore, "recordPractice").mockRejectedValueOnce(new Error("quota"));
      await click(container, "Good");
      await waitForCondition(hasText(container, `${storageLine}: quota.`));
      await waitForCondition(hasText(container, "All caught up"));
      expect(container.textContent).not.toContain("Couldn't save.");
      expect((await getAllCards())[0]?.fsrs.reps).toBe(1);
      await unmount();
    });

    it("shows the header line when a dictation practice write fails", async () => {
      const { container, unmount } = await renderApp();
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
      await unmount();
    });

    it("recovers Mark complete after a failed write", async () => {
      const { container, unmount } = await renderApp();
      await openGreetings(container);
      vi.spyOn(progressStore, "markLessonComplete").mockRejectedValueOnce(new Error("quota"));
      await click(container, "Mark complete");
      await waitForCondition(hasText(container, "Couldn't save. Try again."));
      await click(container, "Mark complete");
      await waitForCondition(() => buttonsNamed(container, "Completed").length === 1);
      expect(container.textContent).not.toContain("Couldn't save.");
      await unmount();
    });

    it("recovers Delete lesson after a failed write", async () => {
      await putUserLesson(userLesson);
      vi.stubGlobal("confirm", () => true);
      const { container, unmount } = await renderApp();
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
      await unmount();
    });

    it("keeps the Create error line when saving a lesson fails", async () => {
      vi.spyOn(userLessonsStore, "putUserLesson").mockRejectedValueOnce(new Error("quota exceeded"));
      const { container, unmount } = await renderApp();
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
      await unmount();
    });

    it("Retry re-fetches the library after a failure", async () => {
      let fail = true;
      let release: () => void = () => undefined;
      const { container, unmount } = await renderApp(async (path) => {
        if (path === "/lessons" && fail) {
          return new Response("boom", { status: 500 });
        }
        if (path === "/lessons") {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return responseFor(path);
      });
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
      await unmount();
    });

    it("moves focus from Retry to the library h1 before Retry unmounts into the loading line", async () => {
      let fail = true;
      const { container, unmount } = await renderApp((path) =>
        path === "/lessons" && fail ? new Response("boom", { status: 500 }) : responseFor(path),
      );
      await waitForCondition(hasText(container, "Unable to load lessons"));
      fail = false;
      buttonsNamed(container, "Retry")[0]!.focus();
      await click(container, "Retry");
      expect(document.activeElement).toBe(container.querySelector("main h1"));
      await waitForCondition(hasText(container, "Greetings & Basics"));
      expect(document.activeElement).toBe(container.querySelector("main h1"));
      await unmount();
    });

    it("shows the no-cards empty state and Go to library switches the view", async () => {
      const { container, unmount } = await renderApp();
      await click(container, "Review");
      await waitForCondition(
        hasText(container, "Nothing to review yet. Save a sentence or a word from a lesson to build your deck."),
      );
      await click(container, "Go to library");
      expect(container.querySelector("h1")?.textContent).toBe("Lesson library");
      await waitForCondition(hasText(container, "Greetings & Basics"));
      await unmount();
    });

    it("shows All caught up when cards exist but none are due", async () => {
      const card = createCard({ front: "f", back: "b", source: { lessonId: "l", sentenceId: "s", word: "" } }, new Date());
      await putCard({ ...card, fsrs: { ...card.fsrs, due: new Date(Date.now() + 86_400_000), state: State.Review } });
      const { container, unmount } = await renderApp();
      await click(container, "Review");
      await waitForCondition(hasText(container, "All caught up. Come back later for your next review."));
      const line = Array.from(container.querySelectorAll("p")).find((p) => p.textContent?.startsWith("All caught up"));
      expect(line?.tabIndex).toBe(-1);
      expect(buttonsNamed(container, "Go to library")).toHaveLength(1);
      await unmount();
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
      const { container, unmount } = await renderApp();
      await click(container, "Review");
      await waitForCondition(hasText(container, "Daily limit of 20 new cards reached. 3 new cards are waiting."));
      expect(container.textContent).toContain("0 due");
      await unmount();
    });

    it("never paints Lesson unavailable while a library lesson loads", async () => {
      const seen: string[] = [];
      const { container, unmount } = await renderApp();
      const observer = new MutationObserver(() => seen.push(container.textContent ?? ""));
      observer.observe(container, { childList: true, subtree: true, characterData: true });
      await openGreetings(container);
      observer.disconnect();
      expect(seen.some((text) => text.includes("Loading lesson..."))).toBe(true);
      expect(seen.some((text) => text.includes("Lesson unavailable"))).toBe(false);
      await unmount();
    });

    it("clears a backup error on the next successful export", async () => {
      Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:backup") });
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
      vi.spyOn(backupStore, "exportBackupData").mockRejectedValueOnce(new Error("export broke"));
      const { container, unmount } = await renderApp();
      await click(container, "Export");
      await waitForCondition(hasText(container, "Backup error: export broke"));
      await click(container, "Export");
      await waitForCondition(() => !hasText(container, "Backup error")());
      await click(container, "Export CSV");
      expect(container.textContent).not.toContain("Backup error");
      await unmount();
    });

    it("drops a pending return focus when the view changes before the rows mount", async () => {
      let release: () => void = () => undefined;
      let lessonsCalls = 0;
      const { container, unmount } = await renderApp(async (path) => {
        if (path === "/lessons" && ++lessonsCalls > 2) {
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        }
        return responseFor(path);
      });
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
      await unmount();
    });
  });

  describe("sync status, session loss, and account errors", () => {
    const originalStorage = Object.getOwnPropertyDescriptor(navigator, "storage");

    afterEach(() => {
      restoreProperty(navigator, "storage", originalStorage);
    });

    function pathOf(input: Parameters<typeof fetch>[0]): string {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return new URL(url, "http://localhost").pathname;
    }

    function userResponse(): Response {
      return new Response(JSON.stringify({ id: "user-1", email: "restored@example.com" }), { status: 200 });
    }

    function callsTo(path: string): number {
      return fetchMock.mock.calls.filter(([input]) => pathOf(input) === path).length;
    }

    async function renderApp(route: (path: string) => Response | undefined) {
      fetchMock.mockImplementation(async (input) => {
        const path = pathOf(input);
        return route(path) ?? responseFor(path);
      });
      vi.stubGlobal("fetch", fetchMock);
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      await act(async () => {
        root.render(
          <StrictMode>
            <App />
          </StrictMode>,
        );
      });
      const unmount = async () => {
        await act(async () => root.unmount());
        container.remove();
      };
      return { container, unmount };
    }

    async function fillAccountForm(container: HTMLElement, emailValue: string, passwordValue: string, buttonText: string) {
      const email = container.querySelector<HTMLInputElement>('input[aria-label="Email"]');
      const password = container.querySelector<HTMLInputElement>('input[aria-label="Password"]');
      if (!email || !password) throw new Error("account form not found");
      await act(async () => {
        setInputValue(email, emailValue);
        setInputValue(password, passwordValue);
        Array.from(container.querySelectorAll("button"))
          .find((button) => button.textContent === buttonText)
          ?.click();
      });
    }

    const syncFailed = "Couldn't sync. Your changes are saved on this device and will sync when you're back online.";

    it("shows a failed sync and clears it when an online event re-syncs", async () => {
      let offline = true;
      const { container, unmount } = await renderApp((path) => {
        if (path === "/me") return userResponse();
        if (path === "/sync" && offline) throw new TypeError("Failed to fetch");
        return undefined;
      });
      await waitForCondition(() => container.textContent?.includes(syncFailed) ?? false);
      expect(container.textContent).toContain("restored@example.com");

      offline = false;
      const before = callsTo("/sync");
      await act(async () => {
        window.dispatchEvent(new Event("online"));
      });
      await waitForCondition(() => !(container.textContent?.includes(syncFailed) ?? true));
      expect(callsTo("/sync")).toBe(before + 1);

      await unmount();
    });

    it("re-syncs when the window gains focus", async () => {
      const { container, unmount } = await renderApp((path) => (path === "/me" ? userResponse() : undefined));
      await waitForCondition(() => callsTo("/sync") === 1);

      await act(async () => {
        window.dispatchEvent(new Event("focus"));
      });
      await waitForCondition(() => callsTo("/sync") === 2);
      expect(container.textContent).toContain("restored@example.com");

      await unmount();
    });

    it("signs the user out with a message when sync returns 401", async () => {
      const { container, unmount } = await renderApp((path) => {
        if (path === "/me") return userResponse();
        if (path === "/sync") return new Response(null, { status: 401 });
        return undefined;
      });
      await waitForCondition(() => container.textContent?.includes("You were signed out. Sign in again to sync.") ?? false);
      expect(container.textContent).not.toContain("restored@example.com");
      expect(container.querySelector('input[aria-label="Email"]')).not.toBeNull();
      expect(container.textContent).not.toContain(syncFailed);

      await unmount();
    });

    it("shows a friendly line when /me is offline and signs in when an online event retries it", async () => {
      let offline = true;
      const { container, unmount } = await renderApp((path) => {
        if (path === "/me") {
          if (offline) throw new TypeError("Failed to fetch");
          return userResponse();
        }
        return undefined;
      });
      await waitForCondition(() => container.textContent?.includes("Can't reach the server. You can keep practising on this device.") ?? false);
      expect(container.textContent).not.toContain("Failed to fetch");

      offline = false;
      await act(async () => {
        window.dispatchEvent(new Event("online"));
      });
      await waitForCondition(() => container.textContent?.includes("restored@example.com") ?? false);
      expect(container.textContent).not.toContain("Can't reach the server");

      await unmount();
    });

    it("does not retry /me on online after a server error", async () => {
      const { container, unmount } = await renderApp((path) => (path === "/me" ? new Response(null, { status: 500 }) : undefined));
      await waitForCondition(() => container.textContent?.includes("Unable to complete account request. Please try again.") ?? false);
      const before = callsTo("/me");

      await act(async () => {
        window.dispatchEvent(new Event("online"));
      });
      expect(callsTo("/me")).toBe(before);

      await unmount();
    });

    it("sends no sign-up request for an invalid email", async () => {
      const { container, unmount } = await renderApp(() => undefined);
      await fillAccountForm(container, "not-an-email", "password", "Sign up");
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
      expect(callsTo("/signup")).toBe(0);

      await unmount();
    });

    it("shows the too-many-attempts line for a 429", async () => {
      const { container, unmount } = await renderApp((path) => (path === "/login" ? new Response(null, { status: 429 }) : undefined));
      await fillAccountForm(container, "learner@example.com", "password", "Sign in");
      await waitForCondition(() => container.textContent?.includes("Too many attempts. Try again in a few minutes.") ?? false);

      await unmount();
    });

    async function importConfirmText(signedIn: boolean): Promise<string> {
      const confirm = vi.fn<(message?: string) => boolean>(() => false);
      vi.stubGlobal("confirm", confirm);
      const { container, unmount } = await renderApp((path) => (path === "/me" && signedIn ? userResponse() : undefined));
      if (signedIn) {
        await waitForCondition(() => container.textContent?.includes("restored@example.com") ?? false);
      }
      const input = container.querySelector<HTMLInputElement>('input[type="file"]');
      if (!input) throw new Error("backup file input not found");
      const text = exportData({ cards: [], practiceDays: [], lessonCompletion: [], userLessons: [] }, new Date());
      await act(async () => {
        Object.defineProperty(input, "files", {
          configurable: true,
          value: [new File([text], "backup.json", { type: "application/json" })],
        });
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await waitForCondition(() => confirm.mock.calls.length === 1);
      await unmount();
      return confirm.mock.calls[0]?.[0] ?? "";
    }

    it("words the import confirm for signed-out and signed-in users", async () => {
      expect(await importConfirmText(false)).toBe(
        "Importing this backup will replace all local data on this device. Continue?",
      );
      expect(await importConfirmText(true)).toBe(
        "Importing this backup will replace all local data on this device. Your next sync merges it with your account, so cards and progress already in your account stay. Continue?",
      );
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
      const { container, unmount } = await renderApp(() => undefined);
      await waitForCondition(() => container.textContent?.includes(expected) ?? false);
      if (persistMock) {
        expect(persistMock).toHaveBeenCalledTimes(1);
      }
      expect(container.textContent).not.toContain("blocked");

      await unmount();
    });
  });

  describe("accessibility", () => {
    async function renderApp() {
      fetchMock.mockImplementation(async (input) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        return responseFor(new URL(url, "http://localhost").pathname);
      });
      vi.stubGlobal("fetch", fetchMock);
      const container = document.createElement("div");
      document.body.appendChild(container);
      const root = createRoot(container);
      await act(async () => {
        root.render(
          <StrictMode>
            <App />
          </StrictMode>,
        );
      });
      return { container, root };
    }

    async function close({ container, root }: { container: HTMLElement; root: ReturnType<typeof createRoot> }) {
      await act(async () => {
        root.unmount();
      });
      container.remove();
    }

    async function click(container: HTMLElement, name: string) {
      const button = buttonsNamed(container, name)[0];
      if (!button) throw new Error(`${name} button not found`);
      await act(async () => {
        button.click();
      });
      return button;
    }

    const h1Texts = (container: HTMLElement) => Array.from(container.querySelectorAll("h1")).map((h1) => h1.textContent);

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

    const todayStrip = (container: HTMLElement) =>
      Array.from(container.querySelectorAll("h2")).find((heading) => heading.textContent === "Today")?.parentElement ?? null;

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
      await close(view);
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
      await close(view);
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
      await close(view);
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
      await close(view);
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
      await close(view);
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
      await close(view);
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
      await close(view);
    });

    it("keeps focus on Mark complete and moves it through the pronunciation disclosure", async () => {
      vi.stubGlobal("webkitSpeechRecognition", class {});
      const view = await openLesson();
      const { container } = view;
      await waitForCondition(() => h1Texts(container)[0] === "Greetings & Basics");

      const complete = buttonsNamed(container, "Mark complete")[0]!;
      complete.focus();
      await click(container, "Mark complete");
      await waitForCondition(() => buttonsNamed(container, "Completed").length === 1);
      expect(document.activeElement).toBe(buttonsNamed(container, "Completed")[0]);
      expect(document.activeElement?.getAttribute("aria-disabled")).toBe("true");

      const toggle = buttonsNamed(container, "Pronunciation check")[0]!;
      toggle.focus();
      await click(container, "Pronunciation check");
      expect(document.activeElement).toBe(buttonsNamed(container, "Enable")[0]);
      await click(container, "Cancel");
      expect(document.activeElement).toBe(buttonsNamed(container, "Pronunciation check")[0]);
      await close(view);
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
      await close(review);
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
      await close(view);
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
      await close(view);
    });

    it("shows no due count in the Today strip while the deck is loading", async () => {
      vi.spyOn(vocabStore, "getAllCards").mockReturnValue(new Promise(() => undefined));
      const view = await renderApp();
      await waitForCondition(() => buttonsNamed(view.container, "Start lesson").length === 1);
      const strip = todayStrip(view.container)!;
      expect(strip.textContent).toContain("Goal 0/10");
      expect(strip.textContent).not.toContain("due");
      await close(view);
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
      await close(view);
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
      await close(view);
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
      await close(view);
    });

    it("makes Enter's action, Sign in, the primary button and keeps Sign up on the keyboard", async () => {
      const view = await renderApp();
      const form = view.container.querySelector<HTMLInputElement>('input[aria-label="Email"]')?.form;
      const submit = form?.querySelector<HTMLButtonElement>('button[type="submit"]');
      const signUp = form ? buttonsNamed(form, "Sign up")[0] : undefined;
      expect(form?.querySelectorAll('button[type="submit"]')).toHaveLength(1);
      expect(submit?.textContent).toBe("Sign in");
      expect(submit?.getAttribute("data-variant")).toBe("primary");
      expect(form?.querySelectorAll('[data-variant="primary"]')).toHaveLength(1);
      expect(signUp?.type).toBe("button");
      expect(signUp?.disabled).toBe(false);
      expect(signUp?.tabIndex).toBe(0);
      await close(view);
    });
  });
});
