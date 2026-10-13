export interface Artifact {
  index: number;
  lang: string;
  code: string;
}

const HTML_FENCE = /```\s*(html|htm)\b[^\n]*\n([\s\S]*?)```/gi;

export function extractArtifacts(content: string): Artifact[] {
  const artifacts: Artifact[] = [];
  let match: RegExpExecArray | null;
  let index = 0;
  HTML_FENCE.lastIndex = 0;
  while ((match = HTML_FENCE.exec(content)) !== null) {
    const code = match[2].trimEnd();
    if (code.length < 40) continue;
    artifacts.push({ index: index++, lang: "html", code });
  }
  return artifacts;
}
