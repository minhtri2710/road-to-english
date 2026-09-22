import { openDB, type DBSchema, type IDBPDatabase } from "idb";

import type { VocabCard } from "./vocab";

export interface AppDatabase extends DBSchema {
  cards: { key: string; value: VocabCard };
  practiceDays: { key: string; value: { date: string } };
  lessonCompletion: { key: string; value: { lessonId: string } };
}

export function openAppDatabase(): Promise<IDBPDatabase<AppDatabase>> {
  return openDB<AppDatabase>("road-to-english", 1, {
    upgrade(db) {
      // Pre-launch: the schema is redefined in place at version 1 — no v2, no migration
      // ladder. Dev data is disposable; clear the "road-to-english" IndexedDB in DevTools
      // when this schema changes.
      db.createObjectStore("cards", { keyPath: "id" });
      db.createObjectStore("practiceDays", { keyPath: "date" });
      db.createObjectStore("lessonCompletion", { keyPath: "lessonId" });
    },
  });
}
