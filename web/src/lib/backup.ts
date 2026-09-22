import { todayKey } from "./progress";
import type { Card } from "ts-fsrs";
import type { VocabCard } from "./vocab";

export interface BackupData {
  cards: VocabCard[];
  practiceDays: { date: string }[];
  lessonCompletion: { lessonId: string }[];
}

interface SerializedFsrs extends Record<string, unknown> {
  due: string;
  last_review?: string | null;
}

interface SerializedCard {
  id: string;
  front: string;
  back: string;
  source: {
    lessonId: string;
    sentenceId: string;
  };
  fsrs: SerializedFsrs;
}

interface SerializedState {
  cards: SerializedCard[];
  practiceDays: { date: string }[];
  lessonCompletion: { lessonId: string }[];
}

interface BackupEnvelope extends BackupData {
  version: 1;
  exportedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === "string" && !value.includes("\u0000");
}

function isNonEmptyText(value: unknown): value is string {
  return isText(value) && value.length > 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    return leap ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function timestampParts(value: string): number[] | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:[.,](\d+))?Z$/.exec(value);
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

  return [year, month, day, hour, minute, second, Number(match[7]?.slice(0, 3).padEnd(3, "0") ?? 0)];
}

function reviveTimestamp(value: string): Date {
  const parts = timestampParts(value);
  if (!parts) {
    throw new Error("Invalid timestamp.");
  }
  const [year, month, day, hour, minute, second, milliseconds] = parts;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, milliseconds);
  return date;
}

export function isValidTimestamp(value: unknown): value is string {
  return typeof value === "string" && timestampParts(value) !== null;
}

export function isValidDayKey(value: unknown): value is string {
  if (typeof value !== "string" || !/^(\d{4})-(\d{2})-(\d{2})$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function validateCard(value: unknown, index: number): asserts value is SerializedCard {
  if (!isRecord(value)) {
    throw new Error(`Invalid card at index ${index}.`);
  }

  const source = value.source;
  const fsrs = value.fsrs;
  if (
    !isNonEmptyText(value.id) ||
    !isNonEmptyText(value.front) ||
    !isText(value.back) ||
    !isRecord(source) ||
    !isNonEmptyText(source.lessonId) ||
    !isNonEmptyText(source.sentenceId) ||
    value.id !== `${source.lessonId}:${source.sentenceId}` ||
    !isRecord(fsrs) ||
    !isValidTimestamp(fsrs.due)
  ) {
    throw new Error(`Invalid card at index ${index}.`);
  }

  if (
    "last_review" in fsrs &&
    fsrs.last_review !== null &&
    !isValidTimestamp(fsrs.last_review)
  ) {
    throw new Error(`Invalid card at index ${index}.`);
  }
}

export function validateBackupData(value: unknown): asserts value is SerializedState {
  if (!isRecord(value) || !Array.isArray(value.cards) || !Array.isArray(value.practiceDays) || !Array.isArray(value.lessonCompletion)) {
    throw new Error("Invalid backup stores.");
  }

  const cardIds = new Set<string>();
  value.cards.forEach((card, index) => {
    validateCard(card, index);
    if (cardIds.has(card.id)) {
      throw new Error(`Duplicate card at index ${index}.`);
    }
    cardIds.add(card.id);
  });

  value.practiceDays.forEach((practiceDay, index) => {
    if (!isRecord(practiceDay) || !isValidDayKey(practiceDay.date)) {
      throw new Error(`Invalid practice day at index ${index}.`);
    }
  });

  value.lessonCompletion.forEach((completion, index) => {
    if (!isRecord(completion) || !isNonEmptyText(completion.lessonId)) {
      throw new Error(`Invalid lesson completion at index ${index}.`);
    }
  });
}

export function reviveBackupData(value: unknown): BackupData {
  validateBackupData(value);
  return {
    cards: value.cards.map((card) => ({
      ...card,
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
  };
}

export function exportData(state: BackupData, now: Date): string {
  const backup: BackupEnvelope = {
    version: 1,
    exportedAt: now.toISOString(),
    cards: state.cards,
    practiceDays: state.practiceDays,
    lessonCompletion: state.lessonCompletion,
  };
  return JSON.stringify(backup);
}

export function importData(text: string): BackupData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Invalid backup JSON.");
  }

  if (
    !isRecord(parsed) ||
    parsed.version !== 1 ||
    typeof parsed.exportedAt !== "string"
  ) {
    throw new Error("Invalid backup envelope.");
  }

  return reviveBackupData(parsed);
}

export function backupFileName(now: Date): string {
  return `road-to-english-backup-${todayKey(now)}.json`;
}
