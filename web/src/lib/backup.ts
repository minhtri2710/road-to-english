import type { Lesson } from "../api/lessons";
import { tr } from "../i18n";
import type { StoredCard, StoredLearnProgress } from "./db";
import { daysInMonth, todayKey } from "./progress";
import { isValidUserLesson } from "./userLessons";
import type { Card } from "ts-fsrs";
import { cardId, isKeySize, isRecord, isText, type CardSource, type VocabCard } from "./vocab";
import { isCardWord } from "./words";

// The /sync wire state. User lessons are local-only and never part of it.
export interface SyncState {
  cards: VocabCard[];
  practiceDays: { date: string }[];
  lessonCompletion: { lessonId: string }[];
  learnProgress: StoredLearnProgress[];
}

// The api's caps on one lesson's Learn progress (api/internal/storage).
const MAX_PASSED_SENTENCES = 10000;
const MAX_SKIPS_USED = 1000;

// The /sync request: every card carries its stored dirty flag.
export interface SyncRequest extends Omit<SyncState, "cards"> {
  cards: StoredCard[];
}

// A /sync 200: the server's full state and the epoch of the server's copy.
export interface SyncReply extends SyncState {
  syncEpoch: string;
}

// The backup file body: the sync state plus the device's user lessons.
export interface BackupData extends SyncState {
  userLessons: Lesson[];
}

interface SerializedFsrs extends Record<string, unknown> {
  due: string;
  last_review?: string | null;
}

interface SerializedCard {
  id: string;
  front: string;
  back: string;
  source: CardSource;
  fsrs: SerializedFsrs;
  updatedAt: string;
  deletedAt: string | null;
}

interface SerializedState {
  cards: SerializedCard[];
  practiceDays: { date: string }[];
  lessonCompletion: { lessonId: string }[];
  // Missing from a backup file written before Learn progress was saved.
  learnProgress?: StoredLearnProgress[];
}

interface BackupEnvelope extends BackupData {
  version: 1;
  exportedAt: string;
}

function isNonEmptyText(value: unknown): value is string {
  return isText(value) && value.length > 0;
}

function timestampParts(value: string): number[] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?Z$/.exec(value);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (
    year < 1 ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > daysInMonth(year, month) ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return null;
  }

  return [year, month, day, hour, minute, second, Number(match[7]?.padEnd(3, "0") ?? 0)];
}

function reviveTimestamp(value: string): Date {
  const parts = timestampParts(value);
  if (!parts) {
    throw new Error(tr("Invalid timestamp."));
  }
  const [year, month, day, hour, minute, second, milliseconds] = parts;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, milliseconds);
  return date;
}

function isValidTimestamp(value: unknown): value is string {
  return typeof value === "string" && timestampParts(value) !== null;
}

function isValidDayKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^(\d{4})-(\d{2})-(\d{2})$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

// A required FSRS number in [0, max]; the api validFSRS applies the same rules.
function isFsrsNumber(value: unknown, integer: boolean, max = Number.MAX_VALUE): boolean {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= max &&
    (!integer || Number.isInteger(value))
  );
}

function isValidFsrs(fsrs: Record<string, unknown>): boolean {
  return (
    isFsrsNumber(fsrs.stability, false) &&
    isFsrsNumber(fsrs.difficulty, false) &&
    (["elapsed_days", "scheduled_days", "learning_steps", "reps", "lapses"] as const).every((key) =>
      isFsrsNumber(fsrs[key], true, Number.MAX_SAFE_INTEGER),
    ) &&
    isFsrsNumber(fsrs.state, true, 3)
  );
}

function validateCard(value: unknown, index: number): asserts value is SerializedCard {
  if (!isRecord(value)) {
    throw new Error(tr("Invalid card at index {index}.", { index }));
  }

  const source = value.source;
  const fsrs = value.fsrs;
  if (
    !isNonEmptyText(value.id) ||
    !isKeySize(value.id) ||
    !isNonEmptyText(value.front) ||
    !isText(value.back) ||
    !isRecord(source) ||
    !isNonEmptyText(source.lessonId) ||
    !isNonEmptyText(source.sentenceId) ||
    typeof source.word !== "string" ||
    (source.word !== "" && !isCardWord(source.word)) ||
    value.id !== cardId({ lessonId: source.lessonId, sentenceId: source.sentenceId, word: source.word }) ||
    !isRecord(fsrs) ||
    !isValidTimestamp(fsrs.due) ||
    !isValidFsrs(fsrs) ||
    !isValidTimestamp(value.updatedAt) ||
    (value.deletedAt !== null && !isValidTimestamp(value.deletedAt))
  ) {
    throw new Error(tr("Invalid card at index {index}.", { index }));
  }

  if (
    "last_review" in fsrs &&
    fsrs.last_review !== null &&
    !isValidTimestamp(fsrs.last_review)
  ) {
    throw new Error(tr("Invalid card at index {index}.", { index }));
  }
}

function validateSyncState(value: unknown): asserts value is SerializedState {
  if (!isRecord(value) || !Array.isArray(value.cards) || !Array.isArray(value.practiceDays) || !Array.isArray(value.lessonCompletion)) {
    throw new Error(tr("Invalid backup stores."));
  }

  const cardIds = new Set<string>();
  value.cards.forEach((card, index) => {
    validateCard(card, index);
    if (cardIds.has(card.id)) {
      throw new Error(tr("Duplicate card at index {index}.", { index }));
    }
    cardIds.add(card.id);
  });

  value.practiceDays.forEach((practiceDay, index) => {
    if (!isRecord(practiceDay) || !isValidDayKey(practiceDay.date)) {
      throw new Error(tr("Invalid practice day at index {index}.", { index }));
    }
  });

  value.lessonCompletion.forEach((completion, index) => {
    if (!isRecord(completion) || !isNonEmptyText(completion.lessonId) || !isKeySize(completion.lessonId)) {
      throw new Error(tr("Invalid lesson completion at index {index}.", { index }));
    }
  });

  if (value.learnProgress === undefined) return;
  if (!Array.isArray(value.learnProgress)) {
    throw new Error(tr("Invalid backup stores."));
  }
  const progressLessons = new Set<string>();
  value.learnProgress.forEach((progress: unknown, index) => {
    if (!isValidLearnProgress(progress) || progressLessons.has(progress.lessonId)) {
      throw new Error(tr("Invalid Learn progress at index {index}.", { index }));
    }
    progressLessons.add(progress.lessonId);
  });
}

function isValidLearnProgress(value: unknown): value is StoredLearnProgress {
  if (
    !isRecord(value) ||
    !isNonEmptyText(value.lessonId) ||
    !isKeySize(value.lessonId) ||
    !Array.isArray(value.passed) ||
    value.passed.length > MAX_PASSED_SENTENCES ||
    !Number.isInteger(value.skipsUsed) ||
    (value.skipsUsed as number) < 0 ||
    (value.skipsUsed as number) > MAX_SKIPS_USED ||
    !isValidTimestamp(value.updatedAt)
  ) {
    return false;
  }
  const passed = value.passed as unknown[];
  return passed.every((id) => isNonEmptyText(id) && isKeySize(id)) && new Set(passed).size === passed.length;
}

export function reviveSyncState(value: unknown): SyncState {
  validateSyncState(value);
  return {
    cards: value.cards.map((card) => ({
      id: card.id,
      front: card.front,
      back: card.back,
      source: card.source,
      updatedAt: card.updatedAt,
      deletedAt: card.deletedAt,
      fsrs: {
        ...card.fsrs,
        due: reviveTimestamp(card.fsrs.due),
        ...(Object.prototype.hasOwnProperty.call(card.fsrs, "last_review")
          ? {
              last_review:
                card.fsrs.last_review === null
                  ? null
                  : reviveTimestamp(card.fsrs.last_review!),
            }
          : {}),
      } as unknown as Card,
    })),
    practiceDays: value.practiceDays,
    lessonCompletion: value.lessonCompletion,
    learnProgress: (value.learnProgress ?? []).map(({ lessonId, passed, skipsUsed, updatedAt }) => ({ lessonId, passed, skipsUsed, updatedAt })),
  };
}

export function exportData(state: BackupData, now: Date): string {
  const backup: BackupEnvelope = {
    version: 1,
    exportedAt: now.toISOString(),
    cards: state.cards,
    practiceDays: state.practiceDays,
    lessonCompletion: state.lessonCompletion,
    learnProgress: state.learnProgress,
    userLessons: state.userLessons,
  };
  return JSON.stringify(backup);
}

export function importData(text: string): BackupData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(tr("Invalid backup JSON."));
  }

  if (
    !isRecord(parsed) ||
    parsed.version !== 1 ||
    typeof parsed.exportedAt !== "string"
  ) {
    throw new Error(tr("Invalid backup envelope."));
  }

  const userLessons = parsed.userLessons;
  if (!Array.isArray(userLessons)) {
    throw new Error(tr("Invalid backup stores."));
  }
  const lessonIds = new Set<string>();
  userLessons.forEach((lesson, index) => {
    if (!isValidUserLesson(lesson) || lessonIds.has(lesson.id)) {
      throw new Error(tr("Invalid user lesson at index {index}.", { index }));
    }
    lessonIds.add(lesson.id);
  });

  return { ...reviveSyncState(parsed), userLessons };
}

export function backupFileName(now: Date): string {
  return `road-to-english-backup-${todayKey(now)}.json`;
}
