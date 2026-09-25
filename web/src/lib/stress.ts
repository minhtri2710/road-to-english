import { splitWords } from "./words";

// Word -> its distinct CMUdict stress patterns joined by "," ("010", "01,10"); see
// web/scripts/build-stress-dict.mjs.
export type StressDict = Readonly<Record<string, string>>;

export type Intonation = "falling" | "rising";

// A stressed word's syllable count and its primary-stress syllable (0-based).
export interface WordStress {
  syllables: number;
  primary: number;
}

// Unstressed in a sentence. A main-verb have/do/be counts too, a known limit of the rule.
const FUNCTION_WORDS = new Set([
  "a", "an", "the",
  "i", "me", "my", "you", "your", "he", "him", "his", "she", "her", "it", "its",
  "we", "us", "our", "they", "them", "their",
  "am", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did",
  "can", "could", "will", "would", "shall", "should", "may", "might", "must",
  "at", "in", "on", "of", "to", "for", "from", "with", "by", "about", "as", "into", "onto",
  "over", "up", "out", "off", "than",
  "and", "but", "or", "so", "if", "that", "because",
]);

const WH_WORDS = new Set(["what", "where", "when", "why", "who", "whom", "whose", "which", "how"]);

// Yes/no questions start with one of these.
const QUESTION_AUXILIARIES = new Set([
  "do", "does", "did", "is", "are", "am", "was", "were",
  "can", "could", "will", "would", "shall", "should", "may", "might", "must",
  "have", "has", "had",
]);

// A contraction's clitic ("it's", "you're"); n't is not one, so "don't" stays a content word.
const CLITIC = /'(?:s|re|m|ll|ve|d)$/;

// A splitWords part as a dictionary key: lowercase NFC, curly apostrophes straightened, quote marks
// at either end dropped, inner apostrophes and hyphens kept ("don't", "t-shirt").
function dictKey(part: string): string {
  return part.toLowerCase().normalize("NFC").replace(/’/g, "'").replace(/^'+|'+$/g, "");
}

function isFunctionWord(key: string): boolean {
  return FUNCTION_WORDS.has(key.replace(CLITIC, ""));
}

// The stress mark for a splitWords part, or null for a function word, a word missing from the
// dictionary, or one whose patterns disagree on the syllable count or the primary-stress syllable.
export function wordStress(part: string, dict: StressDict): WordStress | null {
  const key = dictKey(part);
  if (isFunctionWord(key) || !Object.hasOwn(dict, key)) {
    return null;
  }
  const marks = dict[key].split(",").map((pattern) =>
    pattern.indexOf("1") === pattern.lastIndexOf("1") ? `${pattern.length}:${pattern.indexOf("1")}` : null,
  );
  const [mark] = marks;
  if (mark === null || marks.some((other) => other !== mark)) {
    return null;
  }
  const [syllables, primary] = mark.split(":").map(Number);
  return primary < 0 ? null : { syllables, primary };
}

// Falling for a statement, exclamation or wh-question; rising for a yes/no question; null for any
// other question or a sentence without terminal punctuation.
export function intonation(text: string): Intonation | null {
  const last = text.trimEnd().at(-1);
  if (last === "." || last === "!") {
    return "falling";
  }
  if (last !== "?") {
    return null;
  }
  const first = splitWords(text)[1];
  const key = first === undefined ? "" : dictKey(first).replace(CLITIC, "");
  if (WH_WORDS.has(key)) {
    return "falling";
  }
  return QUESTION_AUXILIARIES.has(key) ? "rising" : null;
}

// Loads the dictionary chunk; call it only once the learner asks for stress marks. The raw import
// keeps tsc from inferring a type for the 2 MB object.
export async function loadStressDict(): Promise<StressDict> {
  return JSON.parse((await import("./stressDict.json?raw")).default) as StressDict;
}
