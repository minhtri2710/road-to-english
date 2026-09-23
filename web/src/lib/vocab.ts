import {
  createEmptyCard,
  fsrs,
  generatorParameters,
} from "ts-fsrs";
import { State } from "ts-fsrs";
import type { Card, Grade } from "ts-fsrs";

export { Rating, State } from "ts-fsrs";
export type { Grade, Card } from "ts-fsrs";

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

export function reviewCard(card: VocabCard, rating: Grade, now: Date): VocabCard {
  return { ...card, fsrs: scheduler.next(card.fsrs, now, rating).card, updatedAt: now.toISOString() };
}

export function deleteCard(card: VocabCard, now: Date): VocabCard {
  return { ...card, updatedAt: now.toISOString(), deletedAt: now.toISOString() };
}

// Undo: the exact previous card, FSRS state included, live again.
export function restoreCard(card: VocabCard, now: Date): VocabCard {
  return { ...card, updatedAt: now.toISOString(), deletedAt: null };
}

export const NEW_CARDS_PER_DAY = 20;

// Keeps every non-New due card and at most `limit - introducedToday` New cards, in due order.
export function capNewCards(
  due: VocabCard[],
  introducedToday: number,
  limit = NEW_CARDS_PER_DAY,
): VocabCard[] {
  let newLeft = Math.max(0, limit - introducedToday);
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
