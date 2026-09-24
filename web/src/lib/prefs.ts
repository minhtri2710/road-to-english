// Preference storage that survives blocked or full localStorage (for example a SecurityError or QuotaExceededError):
// a write that fails is kept in memory for the session and wins over localStorage until a later write succeeds.
const session = new Map<string, string | null>();

export function readPref(key: string): string | null {
  if (session.has(key)) {
    return session.get(key) ?? null;
  }
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

// Forgets the session copies; the App test harness calls it between tests.
export function clearSessionPrefs(): void {
  session.clear();
}

// Stores value, or removes the key for null.
export function writePref(key: string, value: string | null): void {
  try {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
    session.delete(key);
  } catch {
    session.set(key, value);
  }
}

// "on" once the learner accepts the pronunciation check disclosure in a lesson; review reads it too.
export const PRONUNCIATION_CHECK_KEY = "road-to-english.pronunciationCheck";
