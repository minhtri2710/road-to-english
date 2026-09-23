import { todayKey } from "./progress";
import type { VocabCard } from "./vocab";

const guard = (value: string) => (/^[=+\-@\t\r]/.test(value) ? `'${value}` : value);
const field = (value: string) => `"${value.replaceAll('"', '""')}"`;

export function cardsCsv(cards: VocabCard[]): string {
  const rows = [...cards]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((card) => [card.front, card.back, card.fsrs.due.toISOString()].map(guard));
  return "\uFEFF" + [["front", "back", "due"], ...rows].map((row) => row.map(field).join(",") + "\r\n").join("");
}

export function cardsCsvFileName(now: Date): string {
  return `road-to-english-cards-${todayKey(now)}.csv`;
}
