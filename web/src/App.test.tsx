import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { exportData } from "./lib/backup";
import { cardsCsv } from "./lib/csv";
import { todayKey } from "./lib/progress";
import { recordPractice, getPracticeDays } from "./lib/progressStore";
import { createCard, State } from "./lib/vocab";
import { getAllCards, putCard } from "./lib/vocabStore";
import { blankFor } from "./lib/dictation";
import { listUserLessons } from "./lib/userLessons";
import { greetingsLesson, lessonSummaries } from "./test/fixtures";

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
    expect(input?.getAttribute("aria-label")).toBe("Your answer");
    expect(container.querySelector(`label[for="dictation-${sentence.id}"]`)).not.toBeNull();

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

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Sign out")
        ?.click();
    });
    await waitForCondition(() => container.textContent?.includes("Sign in") ?? false);
    expect(container.textContent).not.toContain("learner@example.com");

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

  it("shows the password policy message for a sign-up 400", async () => {
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
      "Password must be at least 8 characters (and at most 72 bytes).",
    ) ?? false);

    expect(container.textContent).toContain(
      "Password must be at least 8 characters (and at most 72 bytes).",
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
    await waitForCondition(() => second.container.textContent?.includes("Nothing due") ?? false);
    const [reviewed] = await getAllCards();
    expect(reviewed?.fsrs.reps).toBe(1);

    await act(async () => {
      second.root.unmount();
    });
    second.container.remove();
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
      expect(first.container.textContent).toContain("Nothing due");
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

    type PlayerOptions = { videoId: string; host: string; playerVars: object; events: { onReady: () => void; onError: () => void } };
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
      const heading = Array.from(view.container.querySelectorAll("h2")).find((node) => node.textContent === "Tea video")!;
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

    // happy-dom refuses to load script files and fires the script's error event, the same path as a blocked or offline load.
    it("loads the API script once and shows Video unavailable when it fails, keeping the lesson usable", async () => {
      const append = vi.spyOn(document.head, "append");
      const view = await renderApp();
      await createLesson(view.container, "https://youtu.be/dQw4w9WgXcQ", transcript);
      await waitForCondition(() => view.container.textContent?.includes("Back to lessons") ?? false);

      await waitForCondition(() => view.container.textContent?.includes("Video unavailable") ?? false);
      expect(append.mock.calls.map(([node]) => (node as HTMLScriptElement).src)).toEqual([iframeApi]);
      expect(document.querySelector(`script[src="${iframeApi}"]`)).toBeNull();
      expect(buttonsNamed(view.container, "Play clip").every((button) => button.disabled)).toBe(true);
      await act(async () => {
        buttonsNamed(view.container, "Dictation")[0]?.click();
      });
      expect(view.container.querySelector("#dictation-s1")).not.toBeNull();
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
      expect(buttonsNamed(view.container, "Listening…")[0]?.disabled).toBe(true);

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
        "On-device English recognition is unavailable in this browser.",
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
      expect(view.container.textContent).not.toContain("Speech recognition failed");
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
});
