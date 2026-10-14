export interface Artifact {
  index: number;
  lang: string;
  code: string;
  start: number;
  end: number;
}

const HTML_FENCE = /```\s*(html|htm)\b[^\n]*\n([\s\S]*?)```/gi;

function extractArtifacts(content: string): Artifact[] {
  const artifacts: Artifact[] = [];
  let match: RegExpExecArray | null;
  let index = 0;
  HTML_FENCE.lastIndex = 0;
  while ((match = HTML_FENCE.exec(content)) !== null) {
    const code = match[2].trimEnd();
    if (code.length < 40) continue;
    const end = match.index + match[0].length;
    artifacts.push({ index: index++, lang: "html", code, start: match.index, end });
  }
  return artifacts;
}

export type ContentSegment =
  | { kind: "text"; text: string }
  | { kind: "artifact"; artifact: Artifact };

export function splitArtifactSegments(content: string): ContentSegment[] {
  const artifacts = extractArtifacts(content);
  if (artifacts.length === 0) return [{ kind: "text", text: content }];
  const segments: ContentSegment[] = [];
  let cursor = 0;
  for (const artifact of artifacts) {
    if (artifact.start > cursor) {
      segments.push({ kind: "text", text: content.slice(cursor, artifact.start) });
    }
    segments.push({ kind: "artifact", artifact });
    cursor = artifact.end;
  }
  if (cursor < content.length) {
    segments.push({ kind: "text", text: content.slice(cursor) });
  }
  return segments.filter((s) => s.kind === "artifact" || s.text.trim().length > 0);
}
