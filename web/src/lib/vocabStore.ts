import { restoreCard, reviewCard, type Grade, type VocabCard } from "./vocab";

import { withDb, type StoredCard } from "./db";
import { mergeCard } from "./mergeCard";
import { notifyLocalMutation } from "./syncEvents";

export async function putCard(card: VocabCard): Promise<void> {
  return withDb(async (db) => {
    await db.put("cards", { ...card, dirty: true });
    notifyLocalMutation();
  });
}

// Save: merges the new card into the stored copy in one transaction, so a re-save keeps the stored FSRS history.
export async function saveCard(card: VocabCard): Promise<void> {
  return withDb(async (db) => {
    const tx = db.transaction("cards", "readwrite");
    const stored = await tx.store.get(card.id);
    await tx.store.put({ ...(stored ? mergeCard(stored, card) : card), dirty: true });
    await tx.done;
    notifyLocalMutation();
  });
}

// A history merge replaces fsrs at the same updatedAt, so the fsrs is part of a card's version.
function sameFsrs(left: VocabCard, right: VocabCard): boolean {
  return (
    left.fsrs.reps === right.fsrs.reps &&
    left.fsrs.due.getTime() === right.fsrs.due.getTime() &&
    left.fsrs.last_review?.getTime() === right.fsrs.last_review?.getTime()
  );
}

// Two copies of a card are the same version.
export function sameVersion(left: VocabCard, right: VocabCard): boolean {
  return left.updatedAt === right.updatedAt && left.deletedAt === right.deletedAt && sameFsrs(left, right);
}

// The card the UI and the backup file see: the stored card without its sync flag.
export function plainCard(stored: StoredCard): VocabCard {
  const { dirty, ...card } = stored;
  void dirty;
  return card;
}

// Writes `next` only while the stored copy is still exactly `expected`, in one transaction.
async function replaceIfUnchanged(expected: VocabCard, next: VocabCard): Promise<boolean> {
  return withDb(async (db) => {
    const tx = db.transaction("cards", "readwrite");
    const stored = await tx.store.get(expected.id);
    const unchanged = stored !== undefined && sameVersion(stored, expected);
    if (unchanged) {
      await tx.store.put({ ...next, dirty: true });
    }
    await tx.done;
    if (unchanged) {
      notifyLocalMutation();
    }
    return unchanged;
  });
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
  return withDb(async (db) => {
    return (await db.getAll("cards")).map(plainCard);
  });
}

export function dueCards(cards: VocabCard[], now: Date): VocabCard[] {
  const nowTime = now.getTime();

  // ponytail: linear scan + JS sort; add a by-due index if decks grow large.
  return cards
    .filter((card) => card.deletedAt === null && card.fsrs.due.getTime() <= nowTime)
    .sort((left, right) => left.fsrs.due.getTime() - right.fsrs.due.getTime());
}
