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
  // "" for a sentence card; one normalize() token ([a-z0-9]+) for a word card.
  word: string;
}

export interface VocabCard {
  id: string;
  front: string;
  back: string;
  source: CardSource;
  fsrs: Card;
}

export type NewCard = Omit<VocabCard, "id" | "fsrs">;

// Text the api accepts: any string without U+0000.
export function isText(value: unknown): value is string {
  return typeof value === "string" && !value.includes("\u0000");
}

// A word card's word: one non-empty normalize() token.
export function isCardWord(word: string): boolean {
  return /^[a-z0-9]+$/.test(word);
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
  };
}

export function reviewCard(card: VocabCard, rating: Grade, now: Date): VocabCard {
  return { ...card, fsrs: scheduler.next(card.fsrs, now, rating).card };
}

// Keeps every non-New due card and at most `limit - introducedToday` New cards, in due order.
export function capNewCards(
  due: VocabCard[],
  introducedToday: number,
  limit = 20,
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
