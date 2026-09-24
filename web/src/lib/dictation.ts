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

const ONES = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(" ");
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];

function spellBelow1000(n: number): string {
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : "");
  return ONES[Math.floor(n / 100)] + " hundred" + (n % 100 ? " " + spellBelow1000(n % 100) : "");
}

// A digit token as spoken words: 0-999 in words, a leading-zero run digit by
// digit (phone style). Numbers of 1000 and up stay as digits.
function spellNumber(digits: string): string {
  if (digits.length > 1 && digits[0] === "0") return [...digits].map((d) => ONES[+d]).join(" ");
  return digits.length <= 3 ? spellBelow1000(+digits) : digits;
}

// "6:30" -> "six thirty"; "12:05" -> "twelve oh five"; "7:00" -> "seven oclock",
// the normalized form of "seven o'clock" that a recognizer writes as "7:00".
function spellTime(_match: string, hour: string, minutes: string): string {
  if (minutes === "00") return ` ${spellNumber(hour)} oclock `;
  if (minutes[0] === "0") return ` ${spellNumber(hour)} oh ${ONES[+minutes[1]]} `;
  return ` ${spellNumber(hour)} ${spellNumber(minutes)} `;
}

// normalize() tokens with numbers spelled out, so a digit form and its words compare equal.
function tokens(s: string): string[] {
  const n = normalize(s.replace(/\b(\d{1,2}):([0-5]\d)\b/g, spellTime));
  return n ? n.split(" ").flatMap((t) => (/^\d+$/.test(t) ? spellNumber(t).split(" ") : [t])) : [];
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

// Same tokens as diffWords: a hyphen becomes a space, so "t-shirt" and "t shirt"
// both match "t-shirt", and "7" matches "seven".
export function blankMatches(typed: string, answer: string): boolean {
  return tokens(typed).join(" ") === tokens(answer).join(" ");
}
