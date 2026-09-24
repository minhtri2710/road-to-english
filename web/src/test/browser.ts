import { vi } from "vitest";

// Browser media and speech fakes for tests that render the App.

export function installMediaDevices(getUserMedia: () => Promise<MediaStream>): void {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
}

export function installObjectUrlFakes(): { revokeObjectURL: ReturnType<typeof vi.fn> } {
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

export function removeBrowserGlobals(): void {
  vi.stubGlobal("speechSynthesis", undefined);
  vi.stubGlobal("SpeechSynthesisUtterance", undefined);
  vi.stubGlobal("MediaRecorder", undefined);
  delete (window as unknown as Record<string, unknown>).speechSynthesis;
  delete (window as unknown as Record<string, unknown>).SpeechSynthesisUtterance;
  delete (navigator as unknown as Record<string, unknown>).mediaDevices;
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
export function installSpeechFakes() {
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
