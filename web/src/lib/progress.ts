// ponytail: practice days are client-local day keys; cross-timezone unions can create or skip a streak day.
export function todayKey(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function previousDay(dayKey: string): string {
  let [year, month, day] = dayKey.split("-").map(Number);
  if (day > 1) {
    day -= 1;
  } else if (month > 1) {
    month -= 1;
    day = daysInMonth(year, month);
  } else {
    year -= 1;
    month = 12;
    day = 31;
  }
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const MAX_FREEZES = 2;

// Walks sorted unique days: every 7th consecutive day earns a freeze (max 2 held);
// a single missed day spends one freeze and keeps the streak.
export function streakState(days: string[], today: string): { streak: number; freezes: number } {
  const sorted = [...new Set(days)].sort();
  let running = 0;
  let freezes = 0;
  let last: string | undefined;
  for (const day of sorted) {
    const before = previousDay(day);
    if (last !== undefined && last === before) {
      running += 1;
    } else if (last !== undefined && last === previousDay(before) && freezes > 0) {
      freezes -= 1;
      running += 1;
    } else {
      running = 1;
    }
    if (running % 7 === 0) {
      freezes = Math.min(MAX_FREEZES, freezes + 1);
    }
    last = day;
  }

  const yesterday = previousDay(today);
  if (last === today || last === yesterday) {
    return { streak: running, freezes };
  }
  if (last === previousDay(yesterday) && freezes > 0) {
    return { streak: running, freezes: freezes - 1 };
  }
  return { streak: 0, freezes };
}

export function xp(counts: { actions: number }[]): number {
  return 10 * counts.reduce((total, { actions }) => total + actions, 0);
}
