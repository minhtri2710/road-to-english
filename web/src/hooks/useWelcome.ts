import { useState } from "react";

import { readPref, writePref } from "../lib/prefs";

export const WELCOMED_KEY = "road-to-english.welcomed";
export const WELCOMED_VALUE = "done";

// Whether the learner finished or skipped the first-run welcome; only the value this hook writes counts.
export function useWelcome() {
  const [welcomed, setWelcomed] = useState(() => readPref(WELCOMED_KEY) === WELCOMED_VALUE);

  const finishWelcome = () => {
    writePref(WELCOMED_KEY, WELCOMED_VALUE);
    setWelcomed(true);
  };

  return { welcomed, finishWelcome };
}
