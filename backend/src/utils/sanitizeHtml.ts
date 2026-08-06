/** Allowlisted tags for news body HTML. */
const ALLOWED_TAGS = new Set(["p", "br", "strong", "b", "ul", "ol", "li"]);

/**
 * Strip tags/attributes outside the allowlist. Nested content kept when parent is allowed.
 * No scripts, styles, links, or event handlers in v1.
 */
export function sanitizeNewsHtml(input: string): string {
  const raw = String(input ?? "");
  if (!raw.trim()) return "";

  // Drop script/style blocks entirely
  let html = raw
    .replace(/<\s*script[\s\S]*?<\/\s*script\s*>/gi, "")
    .replace(/<\s*style[\s\S]*?<\/\s*style\s*>/gi, "");

  // Normalize void <br>
  html = html.replace(/<\s*br\s*\/?\s*>/gi, "<br>");

  // Remove comments
  html = html.replace(/<!--[\s\S]*?-->/g, "");

  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)\b[^>]*>/g;
  html = html.replace(tagRe, (full, name: string) => {
    const tag = name.toLowerCase();
    if (!ALLOWED_TAGS.has(tag)) return "";
    const closing = full.startsWith("</");
    if (tag === "br") return closing ? "" : "<br>";
    return closing ? `</${tag}>` : `<${tag}>`;
  });

  // Collapse empty paragraphs noise lightly
  html = html.replace(/(<p>\s*<\/p>)+/gi, "");

  return html.trim();
}

/** Plain-text excerpt for feed cards. */
export function htmlToExcerpt(html: string, maxLen = 160): string {
  const text = sanitizeNewsHtml(html)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|li|ul|ol)>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen - 1).trimEnd()}…`;
}
