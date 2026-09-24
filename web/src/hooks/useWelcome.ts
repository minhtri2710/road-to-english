import { useState } from "react";

export const WELCOMED_KEY = "road-to-english.welcomed";
export const WELCOMED_VALUE = "done";

// Whether the learner finished or skipped the first-run welcome; only the value this hook writes counts.
export function useWelcome() {
  const [welcomed, setWelcomed] = useState(() => localStorage.getItem(WELCOMED_KEY) === WELCOMED_VALUE);

  const finishWelcome = () => {
    localStorage.setItem(WELCOMED_KEY, WELCOMED_VALUE);
    setWelcomed(true);
  };

  return { welcomed, finishWelcome };
}
