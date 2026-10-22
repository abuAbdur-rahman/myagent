export interface PasteWrap {
  wrapped: boolean;
  code: string;
  language: string | null;
}

const MARKDOWN_LINE = /^\s*(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|\|)/;

function detectLanguage(text: string): string | null {
  const head = text.slice(0, 400);
  if (/^\s*(<!doctype|<html|<div|<section|<body)/i.test(text)) return "html";
  if (/^\s*[{[]/.test(text) && /"\s*:/.test(text)) return "json";
  if (/^\s*(SELECT|INSERT INTO|UPDATE|DELETE FROM|CREATE TABLE)\b/i.test(text)) return "sql";
  if (/^\s*\$ |^\s*(npm|npx|pnpm|yarn|git|cd|ls|mkdir) /m.test(text)) return "bash";
  if (/\b(fn|impl|let mut|use \w+::|pub struct|pub fn)\b/.test(text)) return "rust";
  if (/\b(def |self\.|import \w+$|print\(|elif )/m.test(text)) return "python";
  if (/^\s*[.#][\w-]+[^{]*\{/m.test(text) && /:\s*[^;]+;/.test(text)) return "css";
  if (/\b(interface |type \w+ =|: string|: number|: boolean|<[A-Z]\w+>)/.test(head)) return "ts";
  if (/\b(const|let|var|function|import|export|class|return)\b|=>|console\./.test(head)) {
    return "js";
  }
  if (/^\s*[\w-]+:\s+\S/m.test(text) && !/[{};]/.test(text)) return "yaml";
  if (/\bpublic\s+(static\s+)?(void|class|int|string)\b|\busing System\b/.test(text)) {
    return "csharp";
  }
  return null;
}

function codeScore(text: string): number {
  let score = 0;
  if (text.includes("\n")) score += 1;
  if (/^\s{2,}\S/m.test(text)) score += 2;
  if (/[{}]/.test(text)) score += 1;
  if (/;(\s|$)/m.test(text)) score += 1;
  if (
    /\b(function|const|let|var|class|import|export|def|fn|return|interface|struct)\b/.test(text) ||
    /=>|::|->/.test(text)
  ) {
    score += 2;
  }
  if (/^\s*(\/\/|\/\*|\*|\/\/\/)/m.test(text)) score += 1;
  return score;
}

export function fenceForPaste(raw: string): PasteWrap {
  const code = raw.replace(/\r\n/g, "\n").replace(/\s+$/, "");
  const unchanged: PasteWrap = { wrapped: false, code, language: null };

  if (!code.includes("\n")) return unchanged;
  if (code.trim().startsWith("```")) return unchanged;
  if (code.trim().length < 12) return unchanged;

  const lines = code.split("\n").filter((line) => line.trim().length > 0);
  if (lines.length < 2) return unchanged;
  if (lines.every((line) => MARKDOWN_LINE.test(line))) return unchanged;

  if (codeScore(code) < 3) return unchanged;

  return { wrapped: true, code, language: detectLanguage(code) };
}

export function fencedBlock(code: string, language: string | null): string {
  const fence = code.includes("```") ? "````" : "```";
  return `${fence}${language ?? ""}\n${code}\n${fence}`;
}
