import { todayKey } from "./progress";
import type { VocabCard } from "./vocab";

export interface BackupData {
  cards: VocabCard[];
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

function validDate(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}

function validateCard(value: unknown, index: number): asserts value is VocabCard {
  if (!isRecord(value)) {
    throw new Error(`Invalid card at index ${index}.`);
  }

  const source = value.source;
  const fsrs = value.fsrs;
  if (
    typeof value.id !== "string" ||
    typeof value.front !== "string" ||
    typeof value.back !== "string" ||
    !isRecord(source) ||
    typeof source.lessonId !== "string" ||
    typeof source.sentenceId !== "string" ||
    !isRecord(fsrs) ||
    !validDate(fsrs.due)
  ) {
    throw new Error(`Invalid card at index ${index}.`);
  }

  if ("last_review" in fsrs && fsrs.last_review !== undefined && !validDate(fsrs.last_review)) {
    throw new Error(`Invalid card at index ${index}.`);
  }
}

function validateBackup(value: unknown): asserts value is BackupEnvelope {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.exportedAt !== "string"
  ) {
    throw new Error("Invalid backup envelope.");
  }
  if (
    !Array.isArray(value.cards) ||
    !Array.isArray(value.practiceDays) ||
    !Array.isArray(value.lessonCompletion)
  ) {
    throw new Error("Invalid backup stores.");
  }

  value.cards.forEach(validateCard);
  value.practiceDays.forEach((practiceDay, index) => {
    if (
      !isRecord(practiceDay) ||
      typeof practiceDay.date !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(practiceDay.date)
    ) {
      throw new Error(`Invalid practice day at index ${index}.`);
    }
  });
  value.lessonCompletion.forEach((completion, index) => {
    if (!isRecord(completion) || typeof completion.lessonId !== "string") {
      throw new Error(`Invalid lesson completion at index ${index}.`);
    }
  });
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

  validateBackup(parsed);

  return {
    cards: parsed.cards.map((card) => ({
      ...card,
      fsrs: {
        ...card.fsrs,
        due: new Date(card.fsrs.due),
        ...(card.fsrs.last_review !== undefined
          ? { last_review: new Date(card.fsrs.last_review) }
          : {}),
      },
    })),
    practiceDays: parsed.practiceDays,
    lessonCompletion: parsed.lessonCompletion,
  };
}

export function backupFileName(now: Date): string {
  return `road-to-english-backup-${todayKey(now)}.json`;
}
