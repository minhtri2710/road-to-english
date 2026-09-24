import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buttonsNamed,
  openLesson,
  resetApp,
} from "../test/app";
import {
  installMediaDevices,
  installObjectUrlFakes,
  installSpeechFakes,
  removeBrowserGlobals,
} from "../test/browser";
import { greetingsLesson } from "../test/fixtures";

describe("SentenceShadowing", () => {
  afterEach(resetApp);

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
    expect(speak).toHaveBeenLastCalledWith(expect.objectContaining({ rate: 0.4 }));
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
    const announced = () =>
      Array.from(container.querySelectorAll('[role="status"]:not([aria-live])')).map((region) => region.textContent);
    expect(announced()).toContain("Recording.");

    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Stop")
        ?.click();
    });
    expect(announced()).toContain("Recording stopped.");
    expect(announced()).not.toContain("Recording.");
    expect(container.querySelector("audio")?.getAttribute("src")).toMatch(/^blob:/);
    expect(container.querySelector("audio")?.getAttribute("aria-label")).toBe("Your recording");
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

    const { container } = await openLesson();
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent === "Record")
        ?.click();
    });
    expect(container.textContent).toContain(
      "Unable to access the microphone. Please allow microphone access to record.",
    );
  });

  it("explains when shadowing browser APIs are unsupported", async () => {
    removeBrowserGlobals();
    const { container } = await openLesson();

    expect(container.textContent).toContain(
      "Listen disabled: speech synthesis is not supported in this browser.",
    );
    expect(container.textContent).toContain(
      "Recording disabled: microphone recording is not supported in this browser.",
    );
    expect(Array.from(container.querySelectorAll("button")).filter(
      (button) => button.textContent === "Listen" || button.textContent === "Record",
    ).every((button) => (button as HTMLButtonElement).disabled)).toBe(true);
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

    const a1 = await openLesson({ ...greetingsLesson, targetWpm: 80 });
    expect(await rateAt(a1.container, "1x")).toBeCloseTo(80 / 180);
    expect(await rateAt(a1.container, "0.5x")).toBeCloseTo(40 / 180);
    await act(async () => {
      a1.root.unmount();
    });
    a1.container.remove();

    const low = await openLesson({ ...greetingsLesson, targetWpm: 1 });
    expect(await rateAt(low.container, "1x")).toBe(0.4);
    expect(await rateAt(low.container, "0.5x")).toBe(0.2);
    await act(async () => {
      low.root.unmount();
    });
    low.container.remove();

    const high = await openLesson({ ...greetingsLesson, targetWpm: 1000 });
    expect(await rateAt(high.container, "1x")).toBe(2);
    expect(await rateAt(high.container, "0.5x")).toBe(1);
  });

  it("highlights the spoken word of the playing sentence and clears it on end", async () => {
    const speech = installSpeechFakes();
    const { container } = await openLesson();
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

    const { container } = await openLesson();
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
  });
});
