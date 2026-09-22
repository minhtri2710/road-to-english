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

export function streak(days: string[], today: string): number {
  const practiced = new Set(days);
  const yesterday = previousDay(today);
  const mostRecent = [...practiced].sort().at(-1);

  if (mostRecent !== today && mostRecent !== yesterday) {
    return 0;
  }

  let count = 0;
  let cursor = mostRecent;
  while (cursor && practiced.has(cursor)) {
    count += 1;
    cursor = previousDay(cursor);
  }
  return count;
}
