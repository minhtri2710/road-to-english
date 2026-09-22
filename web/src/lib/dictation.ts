export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u0027\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchesReference(typed: string, reference: string): boolean {
  return normalize(typed) === normalize(reference);
}
