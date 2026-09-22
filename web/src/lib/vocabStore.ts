import { openDB, type DBSchema, type IDBPDatabase } from "idb";

import type { VocabCard } from "./vocab";

interface VocabDatabase extends DBSchema {
  cards: {
    key: string;
    value: VocabCard;
  };
}

function openVocabDatabase(): Promise<IDBPDatabase<VocabDatabase>> {
  return openDB<VocabDatabase>("road-to-english", 1, {
    upgrade(db) {
      db.createObjectStore("cards", { keyPath: "id" });
    },
  });
}

export async function putCard(card: VocabCard): Promise<void> {
  const db = await openVocabDatabase();
  try {
    await db.put("cards", card);
  } finally {
    db.close();
  }
}

export async function getAllCards(): Promise<VocabCard[]> {
  const db = await openVocabDatabase();
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
    .filter((card) => card.fsrs.due.getTime() <= nowTime)
    .sort((left, right) => left.fsrs.due.getTime() - right.fsrs.due.getTime());
}
