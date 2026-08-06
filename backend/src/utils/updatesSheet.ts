import fs from "fs";
import path from "path";

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

/** Calendar day in Europe/Moscow as YYYY-MM-DD and Russian heading. */
export function moscowToday(): { dayKey: string; headingRu: string } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const year = Number(get("year"));
  const month = Number(get("month"));
  const day = Number(get("day"));
  const dayKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const headingRu = `${day} ${MONTHS_RU[month - 1]} ${year}`;
  return { dayKey, headingRu };
}

export function resolveUpdatesMdPath(): string | null {
  if (process.env.UPDATES_MD_PATH) {
    const p = path.resolve(process.env.UPDATES_MD_PATH);
    if (fs.existsSync(p)) return p;
  }
  const candidates = [
    path.resolve(process.cwd(), "..", "ОБНОВЛЕНИЯ.md"),
    path.resolve(process.cwd(), "ОБНОВЛЕНИЯ.md"),
    path.resolve(process.cwd(), "..", "..", "ОБНОВЛЕНИЯ.md"),
    "/opt/task-manager/ОБНОВЛЕНИЯ.md",
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

/**
 * Extract markdown body under `## {headingRu}` until the next `## ` heading.
 */
export function extractUpdatesSection(markdown: string, headingRu: string): string | null {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const target = `## ${headingRu}`;
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === target) {
      start = i + 1;
      break;
    }
  }
  if (start < 0) return null;

  const body: string[] = [];
  for (let i = start; i < lines.length; i++) {
    if (/^##\s+\d/.test(lines[i].trim())) break;
    body.push(lines[i]);
  }
  const text = body.join("\n").trim();
  return text || null;
}

/** Convert a slice of ОБНОВЛЕНИЯ.md into allowlisted news HTML. */
export function updatesMarkdownToNewsHtml(section: string): string {
  const lines = section.replace(/\r\n/g, "\n").split("\n");
  const parts: string[] = [];
  let listType: "ul" | "ol" | null = null;

  const closeList = () => {
    if (listType) {
      parts.push(listType === "ul" ? "</ul>" : "</ol>");
      listType = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const trimmed = line.trim();
    if (!trimmed || trimmed === "---") {
      closeList();
      continue;
    }

    const h3 = trimmed.match(/^###\s+(.+)$/);
    if (h3) {
      closeList();
      const title = escapeText(h3[1].trim());
      parts.push(`<p><strong>${title}</strong></p>`);
      continue;
    }

    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      if (listType !== "ul") {
        closeList();
        parts.push("<ul>");
        listType = "ul";
      }
      parts.push(`<li>${formatInline(bullet[1])}</li>`);
      continue;
    }

    const numbered = trimmed.match(/^\d+\.\s+(.+)$/);
    if (numbered) {
      if (listType !== "ol") {
        closeList();
        parts.push("<ol>");
        listType = "ol";
      }
      parts.push(`<li>${formatInline(numbered[1])}</li>`);
      continue;
    }

    closeList();
    parts.push(`<p>${formatInline(trimmed)}</p>`);
  }
  closeList();
  return parts.join("");
}

function escapeText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Support **bold** markers from the updates sheet. */
function formatInline(s: string): string {
  const escaped = escapeText(s);
  return escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}
