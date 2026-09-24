// Preference storage that survives blocked localStorage (for example a SecurityError):
// a write that fails is kept in memory for the session, and a read that fails returns it (or null).
const session = new Map<string, string | null>();

export function readPref(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return session.get(key) ?? null;
  }
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
