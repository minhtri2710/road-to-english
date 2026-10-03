import { openDB, type DBSchema, type IDBPDatabase } from "idb";

import type { Lesson } from "../api/lessons";
import type { VocabCard } from "./vocab";

// The stored card: dirty until a 200 settles exactly this version.
export type StoredCard = VocabCard & { dirty: boolean };

interface AppDatabase extends DBSchema {
  cards: { key: string; value: StoredCard };
  practiceDays: { key: string; value: { date: string } };
  lessonCompletion: { key: string; value: { lessonId: string } };
  // syncEpoch is the epoch of the server copy this device last synced with.
  meta: { key: string; value: { key: "owner"; ownerId: string } | { key: "syncEpoch"; epoch: string } };
  // Local-only: not synced, not in backup.
  dailyCounts: { key: string; value: DailyCount };
  // Not synced; carried only by the backup file.
  userLessons: { key: string; value: Lesson };  // Synced and in backup: each lesson's Learn mode progress, newest updatedAt wins.
  learnProgress: { key: string; value: StoredLearnProgress };
}

export interface StoredLearnProgress {
  lessonId: string;
  passed: string[];
  skipsUsed: number;
  updatedAt: string;
}

export interface DailyCount {
  date: string;
  actions: number;
  newCards: number;
}

export function openAppDatabase(): Promise<IDBPDatabase<AppDatabase>> {
  return openDB<AppDatabase>("road-to-english", 2, {
    upgrade(db, oldVersion) {
      // ponytail: one local DB per browser profile; upgrade = key the IndexedDB name by user id.
      // Pre-launch: version 1 is redefined in place, so dev data is disposable. Version 2 only adds
      // learnProgress, so a version 1 database keeps its data.
      if (oldVersion < 1) {
        db.createObjectStore("cards", { keyPath: "id" });
        db.createObjectStore("practiceDays", { keyPath: "date" });
        db.createObjectStore("lessonCompletion", { keyPath: "lessonId" });
        db.createObjectStore("meta", { keyPath: "key" });
        db.createObjectStore("dailyCounts", { keyPath: "date" });
        db.createObjectStore("userLessons", { keyPath: "id" });
      }
      if (oldVersion < 2) {
        db.createObjectStore("learnProgress", { keyPath: "lessonId" });
      }
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
