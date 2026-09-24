import {
  createEmptyCard,
  fsrs,
  generatorParameters,
} from "ts-fsrs";
import { Rating, State } from "ts-fsrs";
import type { Card, Grade } from "ts-fsrs";

export { Rating, State } from "ts-fsrs";
export type { Grade } from "ts-fsrs";

export interface CardSource {
  lessonId: string;
  sentenceId: string;
  // "" for a sentence card; one cardWord() for a word card (see isCardWord).
  word: string;
}

export interface VocabCard {
  id: string;
  front: string;
  back: string;
  source: CardSource;
  fsrs: Card;
  // ISO 8601 UTC time of the last create, review, delete, undo or re-save; the sync merge key.
  updatedAt: string;
  // Set on a tombstone: the card stays stored so the delete syncs, but is out of the deck.
  deletedAt: string | null;
}

export type NewCard = Omit<VocabCard, "id" | "fsrs" | "updatedAt" | "deletedAt">;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Text the api accepts: any string without U+0000.
export function isText(value: unknown): value is string {
  return typeof value === "string" && !value.includes("\u0000");
}

// A word card's word: lowercase letter/digit runs joined by single hyphens ("t-shirt").
export function isCardWord(word: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(word);
}

// The card word for a splitWords part: lowercase, apostrophes dropped, hyphens kept.
export function cardWord(part: string): string {
  return part.toLowerCase().replace(/['’]/g, "");
}

export function cardId({ lessonId, sentenceId, word }: CardSource): string {
  return word === "" ? `${lessonId}:${sentenceId}` : `${lessonId}:${sentenceId}:${word}`;
}

export const CARD_BACK_SEPARATOR = " — ";

// A sentence card: the sentence text on the front; on the back its Vietnamese, when the lesson has
// it, then its notes.
export function sentenceCard(
  lessonId: string,
  sentence: { id: string; text: string; vi: string; notes?: string },
): NewCard {
  return {
    front: sentence.text,
    back: [sentence.vi, sentence.notes].filter(Boolean).join(CARD_BACK_SEPARATOR),
    source: { lessonId, sentenceId: sentence.id, word: "" },
  };
}

// A word card's back: its sentence, then the Vietnamese when the lesson has it.
export function wordCardBack(sentence: string, vi: string): string {
  return vi ? `${sentence}${CARD_BACK_SEPARATOR}${vi}` : sentence;
}

// A word card: the word as the sentence writes it on the front, its sentence card's context on the back.
export function wordCard(lessonId: string, sentence: { id: string; text: string; vi: string }, word: string): NewCard {
  return {
    front: word,
    back: wordCardBack(sentence.text, sentence.vi),
    source: { lessonId, sentenceId: sentence.id, word: cardWord(word) },
  };
}

// A card back split around its Vietnamese, or null when it has none. Only library lessons have
// Vietnamese, never empty and never holding the separator: user lessons keep vi empty. So a word
// card's Vietnamese follows its last separator, and a sentence card's runs to its first, or is the
// whole back without notes.
export function splitCardBack(card: VocabCard): { before: string; vi: string; after: string } | null {
  if (card.source.lessonId.startsWith("user-")) {
    return null;
  }
  if (card.source.word === "") {
    const end = card.back.indexOf(CARD_BACK_SEPARATOR);
    return end === -1
      ? { before: "", vi: card.back, after: "" }
      : { before: "", vi: card.back.slice(0, end), after: card.back.slice(end) };
  }
  const start = card.back.lastIndexOf(CARD_BACK_SEPARATOR);
  if (start === -1) {
    return null;
  }
  const viStart = start + CARD_BACK_SEPARATOR.length;
  return { before: card.back.slice(0, viStart), vi: card.back.slice(viStart), after: "" };
}

// The api MaxKeyBytes: the longest card id, in UTF-8 bytes, that sync accepts.
export const MAX_KEY_BYTES = 1024;

export function isKeySize(value: string): boolean {
  return new TextEncoder().encode(value).length <= MAX_KEY_BYTES;
}

const scheduler = fsrs(generatorParameters({ enable_fuzz: false }));

export function createCard(input: NewCard, now: Date): VocabCard {
  if (input.source.word !== "" && !isCardWord(input.source.word)) {
    throw new Error(`Invalid card word: ${input.source.word}`);
  }
  const id = cardId(input.source);
  if (!isKeySize(id)) {
    throw new Error("Card id too long");
  }
  return {
    id,
    ...input,
    fsrs: createEmptyCard(now),
    updatedAt: now.toISOString(),
    deletedAt: null,
  };
}

// Rates at max(now, updatedAt + 1 ms, last_review): a clock behind another device's review would
// make ts-fsrs throw, and a tie with the stored updatedAt would lose the merge. Stored times never
// go backwards.
function reviewTime(card: VocabCard, now: Date): Date {
  return new Date(Math.max(now.getTime(), Date.parse(card.updatedAt) + 1, card.fsrs.last_review?.getTime() ?? 0));
}

export function reviewCard(card: VocabCard, rating: Grade, now: Date): VocabCard {
  const at = reviewTime(card, now);
  return { ...card, fsrs: scheduler.next(card.fsrs, at, rating).card, updatedAt: at.toISOString() };
}

export const GRADES: readonly Grade[] = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy];

// The due each grade would give if rated now: the reviewCard schedule, without the review.
export function previewIntervals(card: VocabCard, now: Date): Record<Grade, Date> {
  const preview = scheduler.repeat(card.fsrs, reviewTime(card, now));
  return Object.fromEntries(GRADES.map((grade) => [grade, preview[grade].card.due])) as Record<Grade, Date>;
}

const MINUTE = 60_000;

// A duration as short text: "<1 min", "N min", "N h", "N d", "N mo", "N y"; mo and y keep one decimal under 10.
export function formatInterval(ms: number): string {
  if (ms < MINUTE) {
    return "<1 min";
  }
  const minutes = Math.round(ms / MINUTE);
  if (minutes < 60) {
    return `${minutes} min`;
  }
  const hours = Math.round(ms / (60 * MINUTE));
  if (hours < 24) {
    return `${hours} h`;
  }
  const days = Math.round(ms / (24 * 60 * MINUTE));
  if (days < 30) {
    return `${days} d`;
  }
  // Months that round to 12 read as a year, so "12 mo" never shows.
  const months = days / 30;
  const [value, unit] = Math.round(months) < 12 ? [months, "mo"] : [Math.max(1, days / 365), "y"];
  return `${value < 10 ? Number(value.toFixed(1)) : Math.round(value)} ${unit}`;
}

export function deleteCard(card: VocabCard, now: Date): VocabCard {
  return { ...card, updatedAt: now.toISOString(), deletedAt: now.toISOString() };
}

// Undo: the exact previous card, FSRS state included, live again.
export function restoreCard(card: VocabCard, now: Date): VocabCard {
  return { ...card, updatedAt: now.toISOString(), deletedAt: null };
}

export const NEW_CARDS_PER_DAY = 20;

// Keeps every non-New due card and at most `NEW_CARDS_PER_DAY - introducedToday` New cards, in due order.
export function capNewCards(due: VocabCard[], introducedToday: number): VocabCard[] {
  let newLeft = Math.max(0, NEW_CARDS_PER_DAY - introducedToday);
  return due.filter((card) => {
    if (card.fsrs.state !== State.New) {
      return true;
    }
    if (newLeft === 0) {
      return false;
    }
    newLeft -= 1;
    return true;
  });
}
