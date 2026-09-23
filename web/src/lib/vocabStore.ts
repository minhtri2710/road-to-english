import type { VocabCard } from "./vocab";

import { openAppDatabase } from "./db";
import { notifyLocalMutation } from "./syncEvents";

export async function putCard(card: VocabCard): Promise<void> {
  const db = await openAppDatabase();
  try {
    await db.put("cards", card);
    notifyLocalMutation();
  } finally {
    db.close();
  }
}

export async function getAllCards(): Promise<VocabCard[]> {
  const db = await openAppDatabase();
  try {
    return await db.getAll("cards");
  } finally {
    db.close();
  }
}

export function dueCards(cards: VocabCard[], now: Date): VocabCard[] {
  const nowTime = now.getTime();

  // ponytail: linear scan + JS sort; add a by-due index if decks grow large.
  return cards
    .filter((card) => card.deletedAt === null && card.fsrs.due.getTime() <= nowTime)
    .sort((left, right) => left.fsrs.due.getTime() - right.fsrs.due.getTime());
}
