import { restoreCard, type VocabCard } from "./vocab";

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

// Undo: restores the card only while the stored copy is still exactly this tombstone, in one transaction.
export async function restoreTombstone(tombstone: VocabCard, now: Date): Promise<boolean> {
  const db = await openAppDatabase();
  try {
    const tx = db.transaction("cards", "readwrite");
    const stored = await tx.store.get(tombstone.id);
    const unchanged =
      stored !== undefined &&
      stored.updatedAt === tombstone.updatedAt &&
      stored.deletedAt === tombstone.deletedAt;
    if (unchanged) {
      await tx.store.put(restoreCard(tombstone, now));
    }
    await tx.done;
    if (unchanged) {
      notifyLocalMutation();
    }
    return unchanged;
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
