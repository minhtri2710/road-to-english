import { restoreCard, reviewCard, type Grade, type VocabCard } from "./vocab";

import { openAppDatabase } from "./db";
import { mergeCard } from "./mergeCard";
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

// Save: merges the new card into the stored copy in one transaction, so a re-save keeps the stored FSRS history.
export async function saveCard(card: VocabCard): Promise<void> {
  const db = await openAppDatabase();
  try {
    const tx = db.transaction("cards", "readwrite");
    const stored = await tx.store.get(card.id);
    await tx.store.put(stored ? mergeCard(stored, card) : card);
    await tx.done;
    notifyLocalMutation();
  } finally {
    db.close();
  }
}

// Writes `next` only while the stored copy is still exactly `expected`, in one transaction.
async function replaceIfUnchanged(expected: VocabCard, next: VocabCard): Promise<boolean> {
  const db = await openAppDatabase();
  try {
    const tx = db.transaction("cards", "readwrite");
    const stored = await tx.store.get(expected.id);
    const unchanged =
      stored !== undefined &&
      stored.updatedAt === expected.updatedAt &&
      stored.deletedAt === expected.deletedAt;
    if (unchanged) {
      await tx.store.put(next);
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

// Undo: restores the card only while the stored copy is still exactly this tombstone.
export function restoreTombstone(tombstone: VocabCard, now: Date): Promise<boolean> {
  return replaceIfUnchanged(tombstone, restoreCard(tombstone, now));
}

// Rating: writes the review only while the stored copy is still the card that was rated.
export function saveReview(card: VocabCard, rating: Grade, now: Date): Promise<boolean> {
  return replaceIfUnchanged(card, reviewCard(card, rating, now));
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
