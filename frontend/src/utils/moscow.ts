/** Moscow helpers mirrored from backend (UTC+3, no DST). */

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

export function moscowNoonIso(dateKey: string): string {
  return new Date(`${dateKey}T12:00:00+03:00`).toISOString();
}

/** Moscow local date + HH:MM → ISO UTC. */
export function moscowDateTimeIso(dateKey: string, time = "12:00"): string {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time.trim());
  const hh = String(match ? Number(match[1]) : 12).padStart(2, "0");
  const mm = String(match ? Number(match[2]) : 0).padStart(2, "0");
  return new Date(`${dateKey}T${hh}:${mm}:00+03:00`).toISOString();
}

/** HH:MM in Moscow from ISO timestamp. */
export function moscowTimeFromIso(value: string | null | undefined, fallback = "18:00"): string {
  if (!value) return fallback;
  const date = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return fallback;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

/** YYYY-MM-DD before today (Moscow calendar). */
export function isPastMoscowDay(dateKey: string | null | undefined, now = new Date()): boolean {
  if (!dateKey) return false;
  return dateKey < moscowDateKey(now);
}

export function moscowDateKeyFromIso(value: string): string | null {
  const date = new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return null;
  return moscowDateKey(date);
}

export function shiftMonth(dateKey: string, delta: number): string {
  const [y, m] = dateKey.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  const yy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${yy}-${mm}-01`;
}

export function monthLabel(dateKey: string): string {
  const [y, m] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("ru-RU", {
    month: "long",
    year: "numeric",
    timeZone: "Europe/Moscow",
  }).format(new Date(Date.UTC(y, m - 1, 1)));
}

/** Monday-first month grid cells (null = empty padding). */
export function monthGrid(monthKey: string): (string | null)[] {
  const [y, m] = monthKey.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  // getUTCDay: 0 Sun .. 6 Sat → Monday-first index
  const startPad = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < startPad; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push(`${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export function checklistDayKey(checklist: {
  planned_for: string | null;
  expires_at: string | null;
}): string | null {
  if (checklist.planned_for) return checklist.planned_for;
  if (checklist.expires_at) return moscowDateKeyFromIso(checklist.expires_at);
  return null;
}

export function taskDayKey(task: {
  planned_for?: string | null;
  due_at: string | null;
  created_at?: string;
}, opts?: { fallbackCreated?: boolean }): string | null {
  if (task.planned_for) return task.planned_for;
  if (task.due_at) return moscowDateKeyFromIso(task.due_at);
  if (opts?.fallbackCreated && task.created_at) {
    return moscowDateKeyFromIso(task.created_at);
  }
  return null;
}

/** True if planned/due day is after today (Moscow) — hidden from home feed. */
export function isDeferredItem(
  dayKey: string | null,
  todayKey: string = moscowDateKey()
): boolean {
  if (!dayKey) return false;
  return dayKey > todayKey;
}
