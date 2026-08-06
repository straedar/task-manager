const MONTHS_RU = [
  "января",
  "февраля",
  "марта",
  "апреля",
  "мая",
  "июня",
  "июля",
  "августа",
  "сентября",
  "октября",
  "ноября",
  "декабря",
];

function parseUtcish(iso: string): Date {
  // SQLite datetime('now') is UTC-ish without Z; treat as UTC if no timezone.
  const raw = iso.trim();
  if (/Z$|[+-]\d{2}:?\d{2}$/.test(raw)) return new Date(raw);
  return new Date(raw.includes("T") ? `${raw}Z` : `${raw.replace(" ", "T")}Z`);
}

function pad(n: number) {
  return n.toString().padStart(2, "0");
}

/** «1 августа 2026, 14:30» (local). */
export function formatNewsDateTime(iso: string): string {
  const d = parseUtcish(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getDate()} ${MONTHS_RU[d.getMonth()]} ${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Short relative + absolute for feed meta. */
export function formatNewsWhen(iso: string): string {
  const d = parseUtcish(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "только что";
  if (mins < 60) return `${mins} мин. назад`;
  const hours = Math.floor(mins / 60);
  if (hours < 24 && d.getDate() === now.getDate()) {
    return `сегодня в ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (
    d.getDate() === yesterday.getDate() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getFullYear() === yesterday.getFullYear()
  ) {
    return `вчера в ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }
  return formatNewsDateTime(iso);
}
