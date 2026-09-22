import {
  createEmptyCard,
  fsrs,
  generatorParameters,
} from "ts-fsrs";
import type { Card, Grade } from "ts-fsrs";

export { Rating, State } from "ts-fsrs";
export type { Grade, Card } from "ts-fsrs";

export interface VocabCard {
  id: string;
  front: string;
  back: string;
  source: {
    lessonId: string;
    sentenceId: string;
  };
  fsrs: Card;
}

const scheduler = fsrs(generatorParameters({ enable_fuzz: false }));

export function createCard(
  input: {
    front: string;
    back: string;
    source: {
      lessonId: string;
      sentenceId: string;
    };
  },
  now: Date,
): VocabCard {
  return {
    id: `${input.source.lessonId}:${input.source.sentenceId}`,
    ...input,
    fsrs: createEmptyCard(now),
  };
}

export function reviewCard(card: VocabCard, rating: Grade, now: Date): VocabCard {
  return { ...card, fsrs: scheduler.next(card.fsrs, now, rating).card };
}
