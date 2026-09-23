export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type WordDiff =
  | { kind: "correct"; word: string }
  | { kind: "missed"; word: string }
  | { kind: "replaced"; word: string; typed: string }
  | { kind: "extra"; typed: string };

function tokens(s: string): string[] {
  const n = normalize(s);
  return n ? n.split(" ") : [];
}

// Word-level edit distance (Levenshtein over normalize() tokens), walked
// forward from a suffix table. Ties prefer match, then substitution.
export function diffWords(typed: string, reference: string): WordDiff[] {
  const ref = tokens(reference);
  const got = tokens(typed);
  const cost = Array.from({ length: ref.length + 1 }, () =>
    new Array<number>(got.length + 1).fill(0),
  );
  for (let i = ref.length; i >= 0; i--) {
    for (let j = got.length; j >= 0; j--) {
      if (i === ref.length) cost[i][j] = got.length - j;
      else if (j === got.length) cost[i][j] = ref.length - i;
      else
        cost[i][j] = Math.min(
          cost[i + 1][j + 1] + (ref[i] === got[j] ? 0 : 1),
          cost[i + 1][j] + 1,
          cost[i][j + 1] + 1,
        );
    }
  }

  const diff: WordDiff[] = [];
  let i = 0;
  let j = 0;
  while (i < ref.length || j < got.length) {
    if (i < ref.length && j < got.length) {
      const same = ref[i] === got[j];
      if (cost[i][j] === cost[i + 1][j + 1] + (same ? 0 : 1)) {
        diff.push(
          same
            ? { kind: "correct", word: ref[i] }
            : { kind: "replaced", word: ref[i], typed: got[j] },
        );
        i++;
        j++;
        continue;
      }
    }
    if (i < ref.length && cost[i][j] === cost[i + 1][j] + 1) {
      diff.push({ kind: "missed", word: ref[i] });
      i++;
    } else {
      diff.push({ kind: "extra", typed: got[j] });
      j++;
    }
  }
  return diff;
}
