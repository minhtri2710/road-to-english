import { afterEach, describe, expect, it, vi } from "vitest";

import { recognitionSupported, recognizeOnce } from "./recognition";

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
    recognizeOnce();
    expect((latest() as LocalFakeRecognition).processLocally).toBe(true);
  });

  it("does not add processLocally when the browser lacks it", () => {
    install();
    recognizeOnce();
    expect("processLocally" in latest()).toBe(false);
  });

  it.each([
    ["not-allowed", "Microphone or speech recognition permission denied."],
    ["service-not-allowed", "Microphone or speech recognition permission denied."],
    ["language-not-supported", "On-device English recognition is unavailable in this browser."],
    ["no-speech", "No speech detected."],
    ["network", "Speech recognition failed (network)."],
  ])("maps %s to a readable error", async (code, message) => {
    install();
    const { result } = recognizeOnce();
    latest().fail(code);
    await expect(result).rejects.toThrow(message);
  });

  it("never retries in the cloud after on-device recognition is unavailable", async () => {
    install(LocalFakeRecognition);
    const { result } = recognizeOnce();
    latest().fail("language-not-supported");
    await expect(result).rejects.toThrow("On-device English recognition is unavailable");
    expect(FakeRecognition.instances).toHaveLength(1);
    expect(latest().start).toHaveBeenCalledOnce();
  });

  it("rejects an end without a result", async () => {
    install();
    const { result } = recognizeOnce();
    latest().onend?.();
    await expect(result).rejects.toThrow("No speech detected.");
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
    await expect(result).rejects.toThrow("aborted");
  });
});
