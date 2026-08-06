/** SQLite datetime('now') → Date in local timezone */
export function parseTaskDate(value: string): Date | null {
  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

/** SQLite datetime('now') → readable Russian date/time */
export function formatTaskDate(value: string): string {
  const date = parseTaskDate(value);
  if (!date) return value;

  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/** HH:MM in Moscow */
export function formatMoscowClock(value: string): string {
  const date = parseTaskDate(value);
  if (!date) return value;
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** Date + time in Moscow — for deadlines on cards (avoids “only time → think today”). */
export function formatMoscowDeadline(value: string): string {
  const date = parseTaskDate(value);
  if (!date) return value;
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: "Europe/Moscow",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** Local calendar day key YYYY-MM-DD */
export function toDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function dateKeyFromValue(value: string): string | null {
  const date = parseTaskDate(value);
  return date ? toDateKey(date) : null;
}

export function formatDayHeading(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(date);
}
