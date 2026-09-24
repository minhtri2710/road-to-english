import {
  createEmptyCard,
  fsrs,
  generatorParameters,
} from "ts-fsrs";
import { State } from "ts-fsrs";
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

// A sentence card: the sentence text on the front, its notes on the back.
export function sentenceCard(
  lessonId: string,
  sentence: { id: string; text: string; notes?: string },
): NewCard {
  return {
    front: sentence.text,
    back: sentence.notes ?? "",
    source: { lessonId, sentenceId: sentence.id, word: "" },
  };
}

export const CARD_BACK_SEPARATOR = " — ";

// A word card's back: its sentence, then the Vietnamese when the lesson has it.
export function wordCardBack(sentence: string, vi: string): string {
  return vi ? `${sentence}${CARD_BACK_SEPARATOR}${vi}` : sentence;
}

// The Vietnamese part of a word card's back written by wordCardBack, or null when it has none.
// Only library lessons have Vietnamese: user lessons keep vi empty, and library text has no
// separator, so the split is unambiguous.
export function splitCardBack(card: VocabCard): { sentence: string; vi: string } | null {
  const split = card.back.lastIndexOf(CARD_BACK_SEPARATOR);
  if (card.source.word === "" || card.source.lessonId.startsWith("user-") || split === -1) {
    return null;
  }
  return { sentence: card.back.slice(0, split), vi: card.back.slice(split + CARD_BACK_SEPARATOR.length) };
}

const scheduler = fsrs(generatorParameters({ enable_fuzz: false }));

export function createCard(input: NewCard, now: Date): VocabCard {
  if (input.source.word !== "" && !isCardWord(input.source.word)) {
    throw new Error(`Invalid card word: ${input.source.word}`);
  }
  return {
    id: cardId(input.source),
    ...input,
    fsrs: createEmptyCard(now),
    updatedAt: now.toISOString(),
    deletedAt: null,
  };
}

// Rates at max(now, updatedAt + 1 ms, last_review): a clock behind another device's review would
// make ts-fsrs throw, and a tie with the stored updatedAt would lose the merge. Stored times never
// go backwards.
export function reviewCard(card: VocabCard, rating: Grade, now: Date): VocabCard {
  const at = new Date(
    Math.max(now.getTime(), Date.parse(card.updatedAt) + 1, card.fsrs.last_review?.getTime() ?? 0),
  );
  return { ...card, fsrs: scheduler.next(card.fsrs, at, rating).card, updatedAt: at.toISOString() };
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
