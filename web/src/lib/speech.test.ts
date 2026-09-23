import { afterEach, describe, expect, it, vi } from "vitest";

import { speak } from "./speech";

interface FakeUtterance {
  onend: (() => void) | null;
  onboundary: ((event: { name: string; charIndex: number }) => void) | null;
}

function installSpeechFakes() {
  class Utterance {
    onend: (() => void) | null = null;
    onboundary: ((event: { name: string; charIndex: number }) => void) | null = null;
    constructor(readonly text: string) {}
  }
  vi.stubGlobal("speechSynthesis", { speak: vi.fn(), cancel: vi.fn() });
  vi.stubGlobal("SpeechSynthesisUtterance", Utterance);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("speak", () => {
  it("reports word boundaries and ignores other boundary kinds", () => {
    installSpeechFakes();
    const onWord = vi.fn();
    const utterance = speak("Hello there", 180, 1, { onWord }) as unknown as FakeUtterance;
    utterance.onboundary?.({ name: "word", charIndex: 6 });
    utterance.onboundary?.({ name: "sentence", charIndex: 0 });
    expect(onWord.mock.calls).toEqual([[6]]);
  });

  it("calls onEnd from options", () => {
    installSpeechFakes();
    const onEnd = vi.fn();
    const utterance = speak("Hello", 180, 1, { onEnd }) as unknown as FakeUtterance;
    utterance.onend?.();
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it("ignores boundary and end events of a superseded utterance", () => {
    installSpeechFakes();
    const onWord = vi.fn();
    const onEnd = vi.fn();
    const stale = speak("Hello", 180, 1, { onWord, onEnd }) as unknown as FakeUtterance;
    speak("Bye", 180, 1);
    stale.onboundary?.({ name: "word", charIndex: 0 });
    stale.onend?.();
    expect(onWord).not.toHaveBeenCalled();
    expect(onEnd).not.toHaveBeenCalled();
  });
});
