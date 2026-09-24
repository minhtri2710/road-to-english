// The one word tokenizer: runs of Unicode letters, combining marks and digits. A run starts with a
// letter or digit; a mark only continues one, so "café" is one word.
const RUN = String.raw`[\p{L}\p{N}][\p{L}\p{M}\p{N}]*`;
// A word in text also keeps apostrophes ("John's"), and internal hyphens join runs into one
// compound ("T-shirt").
const TEXT_RUN = String.raw`[\p{L}\p{N}'’][\p{L}\p{M}\p{N}'’]*`;
const TEXT_WORD = `${TEXT_RUN}(?:-${TEXT_RUN})*`;
const CARD_WORD = new RegExp(`^${RUN}(?:-${RUN})*$`, "u");

// A word card's word: NFC, no uppercase or titlecase letter, runs joined by single hyphens
// ("t-shirt", "café"). The api validCardWord enforces the same contract.
export function isCardWord(word: string): boolean {
  return CARD_WORD.test(word) && !/[\p{Lu}\p{Lt}]/u.test(word) && word === word.normalize("NFC");
}

// The card word for a splitWords part: lowercase NFC, apostrophes dropped, hyphens kept.
export function cardWord(part: string): string {
  return part.toLowerCase().normalize("NFC").replace(/['’]/g, "");
}

// Words (apostrophes kept, hyphen compounds whole) and the text between them, in order.
export function splitWords(text: string): string[] {
  return text.split(new RegExp(`(${TEXT_WORD})`, "u"));
}

// The text with each word replaced by `replace(word)`.
export function replaceWords(text: string, replace: (word: string) => string): string {
  return text.replace(new RegExp(TEXT_WORD, "gu"), replace);
}

// The text's lowercase NFC runs, apostrophes dropped ("It's" -> "its"); everything else separates runs.
export function wordRuns(text: string): string[] {
  return cardWord(text).match(new RegExp(RUN, "gu")) ?? [];
}

// The text without leading characters that cannot start a run or trailing ones that cannot end one.
export function trimToWord(text: string): string {
  return text.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{M}\p{N}]+$/gu, "");
}
