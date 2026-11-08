export interface FenceSpan {
  lang: string;
  code: string;
  closed: boolean;
  start: number;
  end: number;
}

function lineStart(content: string, index: number): boolean {
  return index === 0 || content[index - 1] === "\n";
}

function fenceAt(
  content: string,
  index: number,
): { marker: "`" | "~"; ticks: number; infoEnd: number } | null {
  let cursor = index;
  while (cursor < content.length && (content[cursor] === " " || content[cursor] === "\t")) {
    cursor += 1;
  }
  const marker = content[cursor];
  if (marker !== "`" && marker !== "~") return null;
  let ticks = 0;
  while (content[cursor + ticks] === marker) ticks += 1;
  if (ticks < 3) return null;
  const infoEnd = content.indexOf("\n", cursor + ticks);
  if (infoEnd < 0) return null;
  if (marker === "`" && content.slice(cursor + ticks, infoEnd).includes("`")) return null;
  return { marker, ticks, infoEnd };
}

function closingFence(
  content: string,
  from: number,
  marker: "`" | "~",
  ticks: number,
): { start: number; end: number } | null {
  let line = from;
  while (line < content.length) {
    let lineEnd = content.indexOf("\n", line);
    if (lineEnd < 0) lineEnd = content.length;
    let cursor = line;
    while (cursor < lineEnd && (content[cursor] === " " || content[cursor] === "\t")) {
      cursor += 1;
    }
    let count = 0;
    while (cursor + count < lineEnd && content[cursor + count] === marker) count += 1;
    if (count >= ticks && content.slice(cursor + count, lineEnd).trim() === "") {
      return { start: line, end: lineEnd };
    }
    line = lineEnd === content.length ? content.length : lineEnd + 1;
  }
  return null;
}

export function scanFences(content: string): FenceSpan[] {
  const fences: FenceSpan[] = [];
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
    const lang = info.replace(/^[`~]+/, "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    const close = closingFence(content, fence.infoEnd + 1, fence.marker, fence.ticks);
    const bodyStart = fence.infoEnd + 1;
    fences.push({
      lang,
      code: content.slice(bodyStart, close ? close.start : content.length).trimEnd(),
      closed: Boolean(close),
      start: index,
      end: close ? close.end : content.length,
    });
    index = close ? close.end : content.length;
  }
  return fences;
}
