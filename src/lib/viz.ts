import { scanFences } from "./fences";

export type VizSegment =
  | { kind: "text"; text: string }
  | { kind: "viz"; code: string; closed: boolean };

const VIZ_LANGS = new Set(["viz"]);

export function splitVizSegments(content: string, streaming: boolean): VizSegment[] {
  const segments: VizSegment[] = [];
  let cursor = 0;
  for (const fence of scanFences(content)) {
    if (!VIZ_LANGS.has(fence.lang)) continue;
    if (!fence.closed && !streaming) continue;
    if (fence.start > cursor) {
      segments.push({ kind: "text", text: content.slice(cursor, fence.start) });
    }
    segments.push({ kind: "viz", code: fence.code, closed: fence.closed });
    cursor = fence.end;
  }
  if (cursor < content.length) {
    segments.push({ kind: "text", text: content.slice(cursor) });
  }
  return segments.filter((segment) => segment.kind === "viz" || segment.text.trim().length > 0);
}
