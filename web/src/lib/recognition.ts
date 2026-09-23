// Minimal local typing: lib.dom does not declare the SpeechRecognition constructor.
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  processLocally?: boolean;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  abort(): void;
}

type RecognitionConstructor = new () => Recognition;

function recognitionConstructor(): RecognitionConstructor | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }
  const speechWindow = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
}

export function recognitionSupported(): boolean {
  return recognitionConstructor() !== undefined;
}

function errorMessage(code: string): string {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone or speech recognition permission denied.";
    case "language-not-supported":
      return "On-device English recognition is unavailable in this browser.";
    case "no-speech":
      return "No speech detected.";
    default:
      return `Speech recognition failed (${code}).`;
  }
}

let active: { abort(): void } | null = null;

// One utterance, settled exactly once, and one recognition at a time: starting
// another aborts the active one. An abort rejects with name "AbortError".
// processLocally is requested where the browser exposes it; a local failure is
// reported and never retried in the cloud.
export function recognizeOnce(): { result: Promise<string>; abort(): void } {
  const Constructor = recognitionConstructor();
  if (!Constructor) {
    throw new Error("Speech recognition is not supported in this browser.");
  }
  active?.abort();
  const recognition = new Constructor();
  recognition.lang = "en-US";
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  if ("processLocally" in recognition) {
    recognition.processLocally = true;
  }

  let settled = false;
  let resolve!: (transcript: string) => void;
  let reject!: (error: Error) => void;
  const result = new Promise<string>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  const settle = (outcome: string | Error) => {
    if (settled) {
      return;
    }
    settled = true;
    if (active === handle) {
      active = null;
    }
    if (outcome instanceof Error) {
      reject(outcome);
    } else {
      resolve(outcome);
    }
  };

  const handle = {
    result,
    abort: () => {
      const error = new Error("Speech recognition aborted.");
      error.name = "AbortError";
      settle(error);
      recognition.abort();
    },
  };
  active = handle;

  recognition.onresult = (event) => settle(event.results[0]?.[0]?.transcript ?? "");
  recognition.onerror = (event) => settle(new Error(errorMessage(event.error)));
  recognition.onend = () => settle(new Error(errorMessage("no-speech")));
  try {
    recognition.start();
  } catch (error) {
    settle(error instanceof Error ? error : new Error(String(error)));
  }

  return handle;
}
