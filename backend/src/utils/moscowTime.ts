/** Moscow is UTC+3 year-round (no DST). */

export function moscowDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const y = parts.find((p) => p.type === "year")!.value;
  const m = parts.find((p) => p.type === "month")!.value;
  const d = parts.find((p) => p.type === "day")!.value;
  return `${y}-${m}-${d}`;
}

/** 19:00:00 Moscow on the calendar day of `date` (ISO UTC string). */
export function moscowDeadlineIso(date = new Date()): string {
  return new Date(`${moscowDateKey(date)}T19:00:00+03:00`).toISOString();
}

/** Noon Moscow on a YYYY-MM-DD key — used as task due_at for planner days. */
export function moscowNoonIso(dateKey: string): string {
  return new Date(`${dateKey}T12:00:00+03:00`).toISOString();
}

export function moscowDeadlineIsoFromKey(dateKey: string): string {
  return new Date(`${dateKey}T19:00:00+03:00`).toISOString();
}

/** YYYY-MM-DD before today (Moscow calendar). */
export function isPastMoscowDay(dateKey: string | null | undefined, now = new Date()): boolean {
  if (!dateKey) return false;
  return dateKey < moscowDateKey(now);
}
