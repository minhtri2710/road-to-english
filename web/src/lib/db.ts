import { openDB, type DBSchema, type IDBPDatabase } from "idb";

import type { Lesson } from "../api/lessons";
import type { VocabCard } from "./vocab";

interface AppDatabase extends DBSchema {
  cards: { key: string; value: VocabCard };
  practiceDays: { key: string; value: { date: string } };
  lessonCompletion: { key: string; value: { lessonId: string } };
  meta: { key: string; value: { key: string; ownerId: string } };
  // Local-only: not synced, not in backup.
  dailyCounts: { key: string; value: DailyCount };
  // Not synced; carried only by the backup file.
  userLessons: { key: string; value: Lesson };
}

export interface DailyCount {
  date: string;
  actions: number;
  newCards: number;
}

export function openAppDatabase(): Promise<IDBPDatabase<AppDatabase>> {
  return openDB<AppDatabase>("road-to-english", 1, {
    upgrade(db) {
      // ponytail: one local DB per browser profile; upgrade = key the IndexedDB name by user id.
      // Pre-launch: the schema is redefined in place at version 1 — no v2, no migration
      // ladder. Dev data is disposable; clear the "road-to-english" IndexedDB in DevTools
      // when this schema changes.
      db.createObjectStore("cards", { keyPath: "id" });
      db.createObjectStore("practiceDays", { keyPath: "date" });
      db.createObjectStore("lessonCompletion", { keyPath: "lessonId" });
      db.createObjectStore("meta", { keyPath: "key" });
      db.createObjectStore("dailyCounts", { keyPath: "date" });
      db.createObjectStore("userLessons", { keyPath: "id" });
    },
  });
}

// Opens per call: tests swap indexedDB per test and the e2e storage-failure spec overrides indexedDB.open.
export async function withDb<T>(fn: (db: IDBPDatabase<AppDatabase>) => Promise<T>): Promise<T> {
  const db = await openAppDatabase();
  try {
    return await fn(db);
  } finally {
    db.close();
  }
}
