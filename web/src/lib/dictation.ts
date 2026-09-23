import { cardWord, isCardWord } from "./vocab";

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

// Letter/digit runs (apostrophes kept, internal hyphens joining runs into one
// compound such as "T-shirt") and the text between them, in order.
export function splitWords(text: string): string[] {
  return text.split(/([A-Za-z0-9'’]+(?:-[A-Za-z0-9'’]+)*)/);
}

// Picks the longest card word (earliest on a tie) from the splitWords split
// SentenceWords uses; index -1 when the text has no word. The answer may be a
// compound ("t-shirt"); check typed text with blankMatches.
export function blankFor(text: string): { parts: string[]; index: number; answer: string } {
  const parts = splitWords(text);
  let index = -1;
  let answer = "";
  parts.forEach((part, i) => {
    const word = cardWord(part);
    if (isCardWord(word) && word.length > answer.length) {
      index = i;
      answer = word;
    }
  });
  return { parts, index, answer };
}

// normalize() turns a hyphen into a space, so "t-shirt" and "t shirt" both match "t-shirt".
export function blankMatches(typed: string, answer: string): boolean {
  return normalize(typed) === normalize(answer);
}
