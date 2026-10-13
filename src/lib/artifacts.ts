export interface Artifact {
  index: number;
  lang: string;
  code: string;
}

const FENCE = /```([\w+-]*)\n([\s\S]*?)```/g;

export function extractArtifacts(content: string): Artifact[] {
  const artifacts: Artifact[] = [];
  let match: RegExpExecArray | null;
  let index = 0;
  FENCE.lastIndex = 0;
  while ((match = FENCE.exec(content)) !== null) {
    const lang = match[1] || "text";
    const code = match[2].trimEnd();
    if (code.length < 40) continue;
    artifacts.push({ index: index++, lang, code });
  }
  return artifacts;
}
