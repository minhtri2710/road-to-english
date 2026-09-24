import { afterEach, describe, expect, it, vi } from "vitest";

import {
  actionsToday,
  buttonsNamed,
  click,
  harnessAct,
  openLesson,
  resetApp,
  waitForActions,
  waitForCondition,
} from "../test/app";
import { installMediaDevices, installObjectUrlFakes, installSpeechFakes } from "../test/browser";
import { greetingsLesson } from "../test/fixtures";

const [first, second, third] = greetingsLesson.sentences;

class Recorder {
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
}

async function openGuided() {
  const speech = installSpeechFakes();
  installMediaDevices(async () => ({ getTracks: () => [{ stop: vi.fn() }] }) as unknown as MediaStream);
  installObjectUrlFakes();
  vi.stubGlobal("MediaRecorder", Recorder);
  const view = await openLesson();
  await click(view.container, "One at a time");
  return { ...view, speech };
}

const heading = (container: HTMLElement) => container.querySelector("h2");
const cards = (container: HTMLElement) => buttonsNamed(container, "Text").length;
const announced = (container: HTMLElement) =>
  Array.from(container.querySelectorAll('[role="status"]')).map((region) => region.textContent);

// A recording of at least one second, which counts as practice.
async function record(container: HTMLElement) {
  await click(container, "Record");
  await waitForCondition(() => buttonsNamed(container, "Stop").length === 1);
  vi.setSystemTime(Date.now() + 1000);
  await click(container, "Stop");
  await waitForCondition(() => container.querySelector("audio") !== null);
}

describe("guided shadowing", () => {
  afterEach(async () => {
    await resetApp();
    vi.useRealTimers();
  });

  it("offers One at a time only in Shadow mode, and leaving Shadow mode ends it", async () => {
    installSpeechFakes();
    const { container } = await openLesson();
    const toggle = buttonsNamed(container, "One at a time")[0];
    expect(toggle?.getAttribute("aria-pressed")).toBe("false");

    await click(container, "Dictation");
    expect(buttonsNamed(container, "One at a time")).toHaveLength(0);
    await click(container, "Shadow");
    await click(container, "One at a time");
    expect(heading(container)?.textContent).toBe("Sentence 1 of 3");
    await click(container, "Dictation");
    await click(container, "Shadow");
    expect(buttonsNamed(container, "One at a time")[0]?.getAttribute("aria-pressed")).toBe("false");
    expect(heading(container)).toBeNull();
    expect(cards(container)).toBe(3);
  });

  it("shows one sentence with its heading and step guide, and turning it off restores the list", async () => {
    const { container } = await openGuided();
    expect(buttonsNamed(container, "One at a time")[0]?.getAttribute("aria-pressed")).toBe("true");
    expect(heading(container)?.textContent).toBe("Sentence 1 of 3");
    expect(cards(container)).toBe(1);
    expect(container.textContent).toContain(first.text);
    expect(container.textContent).not.toContain(second.text);
    expect(container.textContent).toContain("Listen to the sentence.");
    expect(container.textContent).toContain("Go to the next sentence.");

    await click(container, "One at a time");
    expect(heading(container)).toBeNull();
    expect(cards(container)).toBe(3);
    expect(buttonsNamed(container, "Next")).toHaveLength(0);
  });

  it("steps with Next and Previous, focuses and announces the heading, and does nothing at the bounds", async () => {
    const { container } = await openGuided();
    const previous = buttonsNamed(container, "Previous")[0]!;
    expect(previous.getAttribute("aria-disabled")).toBe("true");
    previous.focus();
    await click(container, "Previous");
    expect(heading(container)?.textContent).toBe("Sentence 1 of 3");
    expect(document.activeElement).toBe(previous);
    expect(announced(container)).not.toContain("Sentence 1 of 3");

    await click(container, "Next");
    expect(heading(container)?.textContent).toBe("Sentence 2 of 3");
    expect(container.textContent).toContain(second.text);
    expect(container.textContent).not.toContain(first.text);
    expect(document.activeElement).toBe(heading(container));
    expect(announced(container)).toContain("Sentence 2 of 3");

    await click(container, "Next");
    expect(container.textContent).toContain(third.text);
    const next = buttonsNamed(container, "Next")[0]!;
    expect(next.getAttribute("aria-disabled")).toBe("true");
    next.focus();
    await click(container, "Next");
    expect(heading(container)?.textContent).toBe("Sentence 3 of 3");
    expect(document.activeElement).toBe(next);

    await click(container, "Previous");
    expect(heading(container)?.textContent).toBe("Sentence 2 of 3");
    expect(document.activeElement).toBe(heading(container));
    expect(announced(container).filter((text) => text === "Sentence 2 of 3")).toHaveLength(1);
  });

  it("stops a loop when One at a time is turned on or off", async () => {
    installSpeechFakes();
    const { container } = await openLesson();
    await click(container, "Loop");
    expect(buttonsNamed(container, "Loop")[0]?.getAttribute("aria-pressed")).toBe("true");
    await click(container, "One at a time");
    expect(buttonsNamed(container, "Loop")[0]?.getAttribute("aria-pressed")).toBe("false");
    await click(container, "Loop");
    await click(container, "One at a time");
    expect(buttonsNamed(container, "Loop").map((loop) => loop.getAttribute("aria-pressed"))).toEqual(["false", "false", "false"]);
  });

  it("shows the lesson summary in the guided view once every sentence is recorded", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { container } = await openGuided();
    const summary = () => Array.from(container.querySelectorAll("h2")).find((h2) => h2.textContent === "Lesson complete");
    await record(container);
    await click(container, "Next");
    await record(container);
    await click(container, "Next");
    expect(summary()).toBeUndefined();
    await record(container);
    await waitForCondition(() => summary() !== undefined);
    expect(heading(container)?.textContent).toBe("Sentence 3 of 3");
    expect(container.textContent).toContain("You practised all 3 sentences.");
    await waitForCondition(() => container.textContent!.includes("Completed"));
  });

  it("stops a loop and speech on a step", async () => {
    const { container, speech } = await openGuided();
    await click(container, "Loop");
    expect(buttonsNamed(container, "Loop")[0]?.getAttribute("aria-pressed")).toBe("true");
    speech.cancel.mockClear();
    await click(container, "Next");
    expect(speech.cancel).toHaveBeenCalled();
    expect(buttonsNamed(container, "Loop")[0]?.getAttribute("aria-pressed")).toBe("false");
    await click(container, "Previous");
    expect(buttonsNamed(container, "Loop")[0]?.getAttribute("aria-pressed")).toBe("false");
  });

  it("shares hidden text and the Transcript and Vietnamese settings with the list", async () => {
    const { container } = await openGuided();
    await click(container, "Vietnamese");
    expect(container.textContent).toContain(first.vi);
    await click(container, "Text");
    expect(container.textContent).not.toContain(first.text);
    expect(container.textContent).not.toContain(first.vi);

    await click(container, "One at a time");
    expect(buttonsNamed(container, "Text").map((toggle) => toggle.getAttribute("aria-pressed"))).toEqual(["false", "true", "true"]);
    expect(container.textContent).toContain(second.vi);
    await click(container, "Transcript");
    await click(container, "Text", 1);

    await click(container, "One at a time");
    await click(container, "Next");
    expect(buttonsNamed(container, "Text")[0]?.getAttribute("aria-pressed")).toBe("false");
    await click(container, "Next");
    expect(buttonsNamed(container, "Transcript")[0]?.getAttribute("aria-pressed")).toBe("false");
    expect(container.textContent).not.toContain(third.text);
    expect(container.textContent).toContain(third.vi);
  });

  it("resets the recording on a step and counts each sentence's recording once across both views", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { container } = await openGuided();
    await record(container);
    await waitForActions(1);

    await click(container, "Next");
    expect(container.querySelector("audio")).toBeNull();
    await click(container, "Previous");
    expect(container.querySelector("audio")).toBeNull();
    await record(container);

    await click(container, "One at a time");
    await record(container);
    await harnessAct(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(await actionsToday()).toBe(1);
  });
});
