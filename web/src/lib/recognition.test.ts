import { afterEach, describe, expect, it, vi } from "vitest";

import { abortActiveRecognition, recognitionSupported, recognizeOnce } from "./recognition";

class FakeRecognition {
  static instances: FakeRecognition[] = [];
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
    FakeRecognition.instances.push(this);
  }
  say(transcript: string) {
    this.onresult?.({ results: [[{ transcript }]] });
    this.onend?.();
  }
  fail(error: string) {
    this.onerror?.({ error });
    this.onend?.();
  }
}

class LocalFakeRecognition extends FakeRecognition {
  processLocally = false;
}

function install(constructor: typeof FakeRecognition = FakeRecognition) {
  FakeRecognition.instances = [];
  vi.stubGlobal("webkitSpeechRecognition", constructor);
}

const latest = () => FakeRecognition.instances.at(-1)!;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("recognition", () => {
  it("reports support from either constructor", () => {
    expect(recognitionSupported()).toBe(false);
    install();
    expect(recognitionSupported()).toBe(true);
  });

  it("starts with one-shot English settings and resolves the transcript", async () => {
    install();
    const { result } = recognizeOnce();
    const recognition = latest();
    expect(recognition).toMatchObject({
      lang: "en-US",
      continuous: false,
      interimResults: false,
      maxAlternatives: 1,
    });
    expect(recognition.start).toHaveBeenCalledOnce();
    recognition.say("good morning");
    await expect(result).resolves.toBe("good morning");
  });

  it("requests on-device recognition when the browser exposes processLocally", () => {
    install(LocalFakeRecognition);
    recognizeOnce().result.catch(() => {});
    expect((latest() as LocalFakeRecognition).processLocally).toBe(true);
  });

  it("does not add processLocally when the browser lacks it", () => {
    install();
    recognizeOnce().result.catch(() => {});
    expect("processLocally" in latest()).toBe(false);
  });

  it.each([
    ["language-not-supported", "On-device English recognition isn't available in this browser. Use Record and Compare to check yourself."],
    ["network", "Speech recognition couldn't reach its service. Check your connection, or use Record and Compare to check yourself."],
    ["audio-capture", "No microphone was found. Connect a microphone and try again."],
    ["not-allowed", "Microphone or speech recognition access is blocked. Allow it in your browser's site settings and try again."],
    ["service-not-allowed", "Microphone or speech recognition access is blocked. Allow it in your browser's site settings and try again."],
    ["no-speech", "No speech detected. Press Check pronunciation, then say the sentence."],
    ["aborted", "Speech recognition stopped before it heard you. Try again."],
    ["bad-grammar", "Speech recognition failed (bad-grammar). Try again, or use Record and Compare to check yourself."],
  ])("maps %s to an actionable message", async (code, message) => {
    install();
    const { result } = recognizeOnce();
    latest().fail(code);
    await expect(result).rejects.toThrow(new Error(message));
  });

  it("never retries in the cloud after on-device recognition is unavailable", async () => {
    install(LocalFakeRecognition);
    const { result } = recognizeOnce();
    latest().fail("language-not-supported");
    await expect(result).rejects.toThrow("On-device English recognition isn't available");
    expect(FakeRecognition.instances).toHaveLength(1);
    expect(latest().start).toHaveBeenCalledOnce();
  });

  it("rejects an end without a result", async () => {
    install();
    const { result } = recognizeOnce();
    latest().onend?.();
    await expect(result).rejects.toThrow("No speech detected. Press Check pronunciation, then say the sentence.");
  });

  it("settles once", async () => {
    install();
    const { result } = recognizeOnce();
    const recognition = latest();
    recognition.say("first");
    recognition.fail("network");
    recognition.say("second");
    await expect(result).resolves.toBe("first");
  });

  it("aborts the recognition and ignores later events", async () => {
    install();
    const { result, abort } = recognizeOnce();
    const recognition = latest();
    abort();
    recognition.say("too late");
    expect(recognition.abort).toHaveBeenCalledOnce();
    await expect(result).rejects.toMatchObject({ name: "AbortError", message: "Speech recognition aborted." });
  });

  it("abortActiveRecognition aborts the active recognition and is a no-op when idle", async () => {
    install();
    const { result } = recognizeOnce();
    abortActiveRecognition();
    expect(latest().abort).toHaveBeenCalledOnce();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    abortActiveRecognition();
    expect(latest().abort).toHaveBeenCalledOnce();
  });

  it("aborts the active recognition when another starts", async () => {
    install();
    const first = recognizeOnce();
    const firstRecognition = latest();
    const second = recognizeOnce();
    expect(firstRecognition.abort).toHaveBeenCalledOnce();
    await expect(first.result).rejects.toMatchObject({ name: "AbortError" });
    latest().say("still here");
    await expect(second.result).resolves.toBe("still here");
  });

  it("does not abort a recognition that already settled", async () => {
    install();
    const first = recognizeOnce();
    const firstRecognition = latest();
    firstRecognition.say("done");
    await expect(first.result).resolves.toBe("done");
    recognizeOnce().result.catch(() => {});
    expect(firstRecognition.abort).not.toHaveBeenCalled();
  });
});
