import { scanFences } from "../fences";

export type OpenUISegment =
  | { kind: "text"; text: string }
  | { kind: "openui"; code: string; closed: boolean };

const UI_LANGS = new Set(["openui-lang", "openui"]);

export function splitOpenUISegments(content: string, streaming: boolean): OpenUISegment[] {
  const segments: OpenUISegment[] = [];
  let cursor = 0;
  for (const fence of scanFences(content)) {
    if (!UI_LANGS.has(fence.lang)) continue;
    if (!fence.closed && !streaming) continue;
    if (fence.start > cursor) {
      segments.push({ kind: "text", text: content.slice(cursor, fence.start) });
    }
    segments.push({ kind: "openui", code: fence.code, closed: fence.closed });
    cursor = fence.end;
  }
  if (cursor < content.length) {
    segments.push({ kind: "text", text: content.slice(cursor) });
  }
  return segments.filter((segment) => segment.kind === "openui" || segment.text.trim().length > 0);
}
