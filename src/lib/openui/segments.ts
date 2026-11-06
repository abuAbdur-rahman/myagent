export type OpenUISegment =
  | { kind: "text"; text: string }
  | { kind: "openui"; code: string; closed: boolean };

const UI_LANGS = new Set(["openui-lang", "openui"]);

function lineStart(content: string, index: number): boolean {
  return index === 0 || content[index - 1] === "\n";
}

function fenceAt(
  content: string,
  index: number,
): { ticks: number; infoEnd: number } | null {
  let cursor = index;
  while (cursor < content.length && (content[cursor] === " " || content[cursor] === "\t")) {
    cursor += 1;
  }
  if (content[cursor] !== "`") return null;
  let ticks = 0;
  while (content[cursor + ticks] === "`") ticks += 1;
  if (ticks < 3) return null;
  const infoEnd = content.indexOf("\n", cursor + ticks);
  if (infoEnd < 0) return null;
  return { ticks, infoEnd };
}

function closingFence(content: string, from: number, ticks: number): {
  start: number;
  end: number;
} | null {
  let line = from;
  while (line < content.length) {
    let lineEnd = content.indexOf("\n", line);
    if (lineEnd < 0) lineEnd = content.length;
    let cursor = line;
    while (cursor < lineEnd && (content[cursor] === " " || content[cursor] === "\t")) {
      cursor += 1;
    }
    let count = 0;
    while (cursor + count < lineEnd && content[cursor + count] === "`") count += 1;
    if (count >= ticks && content.slice(cursor + count, lineEnd).trim() === "") {
      return { start: line, end: lineEnd };
    }
    line = lineEnd === content.length ? content.length : lineEnd + 1;
  }
  return null;
}

export function splitOpenUISegments(content: string, streaming: boolean): OpenUISegment[] {
  const segments: OpenUISegment[] = [];
  let cursor = 0;
  let index = 0;
  while (index < content.length) {
    if (!lineStart(content, index)) {
      index += 1;
      continue;
    }
    const fence = fenceAt(content, index);
    if (!fence) {
      const next = content.indexOf("\n", index);
      if (next < 0) break;
      index = next + 1;
      continue;
    }
    const info = content.slice(index, fence.infoEnd).trim();
    const lang = info.replace(/^`+/, "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    const close = closingFence(content, fence.infoEnd + 1, fence.ticks);
    if (UI_LANGS.has(lang) && (close || streaming)) {
      if (index > cursor) {
        segments.push({ kind: "text", text: content.slice(cursor, index) });
      }
      const codeEnd = close ? close.start : content.length;
      segments.push({
        kind: "openui",
        code: content.slice(fence.infoEnd + 1, codeEnd).trimEnd(),
        closed: Boolean(close),
      });
      cursor = close ? close.end : content.length;
      index = cursor;
      continue;
    }
    index = close ? close.end : content.length;
  }
  if (cursor < content.length) {
    segments.push({ kind: "text", text: content.slice(cursor) });
  }
  return segments.filter((segment) => segment.kind === "openui" || segment.text.trim().length > 0);
}
