import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App } from "./App";
import { exportData } from "./lib/backup";
import { todayKey } from "./lib/progress";
import { recordPractice, getPracticeDays } from "./lib/progressStore";
import { createCard } from "./lib/vocab";
import { getAllCards, putCard } from "./lib/vocabStore";
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
    expect(container.querySelectorAll("button")).toHaveLength(19);

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

  it("imports a backup through the UI and refreshes the deck and streak", async () => {
    const existing = createCard(
      {
        front: "old card",
        back: "old answer",
        source: { lessonId: "old-lesson", sentenceId: "old-sentence" },
      },
      new Date(),
    );
    await putCard(existing);
    await recordPractice("2025-01-01");

    const importedCard = createCard(
      {
        front: "imported card",
        back: "imported answer",
        source: { lessonId: "lesson-1", sentenceId: "sentence-1" },
      },
      new Date(),
    );
    const text = exportData(
      {
        cards: [importedCard],
        practiceDays: [{ date: todayKey(new Date()) }],
        lessonCompletion: [{ lessonId: "lesson-1" }],
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
});
