export type OpenUISegment =
  | { kind: "text"; text: string }
  | { kind: "openui"; code: string; closed: boolean };

const UI_LANGS = new Set(["openui-lang", "openui"]);

const FENCE =
  /^```[ \t]*([^\n]*)\r?\n([\s\S]*?)(?:\r?\n(```)[ \t]*(?=\r?\n|$)|(?![\s\S]))/gm;

export function splitOpenUISegments(content: string, streaming: boolean): OpenUISegment[] {
  const segments: OpenUISegment[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;
  FENCE.lastIndex = 0;
  while ((match = FENCE.exec(content)) !== null) {
    const lang = match[1].trim().toLowerCase().split(/\s+/)[0] ?? "";
    if (!UI_LANGS.has(lang)) continue;
    const closed = Boolean(match[3]);
    if (!closed && !streaming) continue;
    if (match.index > cursor) {
      segments.push({ kind: "text", text: content.slice(cursor, match.index) });
    }
    segments.push({ kind: "openui", code: match[2].trimEnd(), closed });
    cursor = match.index + match[0].length;
  }
  if (cursor < content.length) {
    segments.push({ kind: "text", text: content.slice(cursor) });
  }
  return segments.filter((segment) => segment.kind === "openui" || segment.text.trim().length > 0);
}
