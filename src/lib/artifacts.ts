export interface Artifact {
  index: number;
  title: string;
  lang: string;
  code: string;
  start: number;
  end: number;
}

const HTML_FENCE =
  /```[ \t]*(html|htm)((?:[ \t][^\n]*)?)\r?\n([\s\S]*?)\r?\n```[ \t]*(?=\r?\n|$)/gi;

function textOf(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function fenceTitle(meta: string): string {
  const match = /title\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/i.exec(meta);
  return textOf(match?.[1] ?? match?.[2] ?? match?.[3] ?? "").slice(0, 80);
}

function documentTitle(code: string): string {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(code)?.[1];
  if (title) return textOf(title).slice(0, 80);
  const heading = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(code)?.[1];
  return heading ? textOf(heading).slice(0, 80) : "";
}

function extractArtifacts(content: string): Artifact[] {
  const artifacts: Artifact[] = [];
  const used = new Set<string>();
  let match: RegExpExecArray | null;
  let index = 0;
  HTML_FENCE.lastIndex = 0;
  while ((match = HTML_FENCE.exec(content)) !== null) {
    const code = match[3].trimEnd();
    if (code.length < 40) continue;
    const base =
      (fenceTitle(match[2]) || documentTitle(code)).replace(/\.html?$/i, "").trim() ||
      "HTML preview";
    let title = base;
    let suffix = 2;
    while (used.has(title.toLowerCase())) {
      title = `${base} ${suffix}`;
      suffix += 1;
    }
    used.add(title.toLowerCase());
    const end = match.index + match[0].length;
    artifacts.push({ index: index++, title, lang: "html", code, start: match.index, end });
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
