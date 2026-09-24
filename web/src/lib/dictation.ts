import { cardWord, isCardWord, replaceWords, splitWords, trimToWord, wordRuns } from "./words";

function normalize(s: string): string {
  return wordRuns(s).join(" ");
}

// Reference entries carry the word as the lesson writes it and the whole written word it came from
// ("T-shirt" for "t" and "shirt"); typed entries carry the normalized token.
export type WordDiff =
  | { kind: "correct"; word: string; written: string }
  | { kind: "missed"; word: string; written: string }
  | { kind: "replaced"; word: string; written: string; typed: string }
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
  return wordRuns(s.replace(/\b(\d{1,2}):([0-5]\d)\b/g, spellTime)).flatMap((t) =>
    /^\d+$/.test(t) ? spellNumber(t).split(" ") : [t],
  );
}

// The reference's tokens, each with the word the lesson writes for it: a word that is one token keeps
// its own form ("John's"), trimmed of edge punctuation; a word of several tokens ("T-shirt", "7:00")
// shows each token.
function referenceWords(reference: string): { token: string; word: string; written: string }[] {
  return reference.split(/\s+/).flatMap((chunk) => {
    const parts = tokens(chunk);
    const written = trimToWord(chunk);
    return parts.map((token) => ({ token, word: parts.length === 1 ? written : token, written }));
  });
}

// Word-level edit distance (Levenshtein over normalize() tokens), walked
// forward from a suffix table. Ties prefer match, then substitution.
export function diffWords(typed: string, reference: string): WordDiff[] {
  const words = referenceWords(reference);
  const ref = words.map((entry) => entry.token);
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
            ? { kind: "correct", word: words[i].word, written: words[i].written }
            : { kind: "replaced", word: words[i].word, written: words[i].written, typed: got[j] },
        );
        i++;
        j++;
        continue;
      }
    }
    if (i < ref.length && cost[i][j] === cost[i + 1][j] + 1) {
      diff.push({ kind: "missed", word: words[i].word, written: words[i].written });
      i++;
    } else {
      diff.push({ kind: "extra", typed: got[j] });
      j++;
    }
  }
  return diff;
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

// The text with every letter (with its marks) masked but the first of each word
// and of each hyphen part: "Good morning, T-shirt!" -> "G___ m______, T-s____!",
// "Zoë" -> "Z__". Digits and punctuation stay.
export function hintFor(text: string): string {
  return replaceWords(text, (word) =>
    word.replace(/\p{L}\p{M}*/gu, (letter, at: number) => (at === 0 || word[at - 1] === "-" ? letter : "_")),
  );
}

// Normalized tokens drop apostrophes, so the "'s" ending is the "s" one.
const ENDINGS = ["s", "es", "d", "ed", "t"];

// Reference words of replaced entries typed without one of ENDINGS
// ("want" for "wanted"), each once, in order.
export function endingHints(diff: WordDiff[]): string[] {
  const words = diff.flatMap((entry) =>
    entry.kind === "replaced" && ENDINGS.some((ending) => normalize(entry.word) === entry.typed + ending) ? [entry.word] : [],
  );
  return [...new Set(words)];
}

// A small string hash (FNV-1a), so the choice order is fixed per seed.
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  }
  return h >>> 0;
}

// The answer and up to 3 distractors from lessonWords (splitWords parts of the
// lesson; card words other than the answer by cardWord, each as written at its
// first appearance, closest in length first, first appearance on ties),
// ordered by seed. Empty when fewer than 2 distractors exist.
export function wordBank(answer: string, lessonWords: string[], seed: string): string[] {
  const written = new Map<string, string>();
  for (const word of lessonWords) {
    const key = cardWord(word);
    if (isCardWord(key) && key !== cardWord(answer) && !written.has(key)) {
      written.set(key, word);
    }
  }
  const length = cardWord(answer).length;
  const distractors = [...written.keys()]
    .sort((a, b) => Math.abs(a.length - length) - Math.abs(b.length - length))
    .slice(0, 3);
  if (distractors.length < 2) {
    return [];
  }
  return [cardWord(answer), ...distractors]
    .sort((a, b) => hash(seed + a) - hash(seed + b))
    .map((key) => written.get(key) ?? answer);
}
