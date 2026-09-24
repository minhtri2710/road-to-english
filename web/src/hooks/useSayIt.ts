import { useEffect, useRef, useState } from "react";

import { recognizeOnce } from "../lib/recognition";

// A spoken attempt at the current card: informs only, never rates or records practice.
export type SayIt =
  | { status: "idle" }
  | { status: "listening" }
  | { status: "heard"; transcript: string }
  | { status: "failed"; message: string };

export function useSayIt(cardTurn: string | null, showAnswer: boolean, stopListening: () => void) {
  // The card turn a Say it attempt belongs to; a new turn or Show answer drops it.
  const [sayIt, setSayIt] = useState<{ turn: string | null; state: SayIt }>({ turn: null, state: { status: "idle" } });
  const sayItState: SayIt = sayIt.turn === cardTurn && !showAnswer ? sayIt.state : { status: "idle" };
  const recognitionRef = useRef<ReturnType<typeof recognizeOnce> | null>(null);
  const sayItRef = useRef<HTMLButtonElement>(null);

  useEffect(
    () => () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    },
    [cardTurn, showAnswer],
  );

  const startSayIt = () => {
    stopListening();
    const turn = cardTurn;
    setSayIt({ turn, state: { status: "listening" } });
    const recognition = recognizeOnce();
    recognitionRef.current = recognition;
    recognition.result.then(
      (transcript) => {
        if (recognitionRef.current !== recognition) return;
        recognitionRef.current = null;
        setSayIt({ turn, state: { status: "heard", transcript } });
      },
      (error: Error) => {
        if (recognitionRef.current !== recognition) return;
        recognitionRef.current = null;
        setSayIt({ turn, state: error.name === "AbortError" ? { status: "idle" } : { status: "failed", message: error.message } });
      },
    );
  };

  // Try again removes itself, so focus goes back to Say it.
  const sayItAgain = () => {
    setSayIt({ turn: cardTurn, state: { status: "idle" } });
    sayItRef.current?.focus();
  };

  return { sayItState, sayItRef, startSayIt, sayItAgain };
}
