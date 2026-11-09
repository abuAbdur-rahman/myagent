import type { Message } from "./types";

export type RollupReason = "close" | "explicit" | "interval";

function explicitRequest(text: string): boolean {
  const value = text.trim();
  if (!value || value.endsWith("?")) return false;
  if (/\b(don't|do not|never|no need to|stop)\b[^.?!;]{0,30}\b(remember|save|note)\b/i.test(value)) {
    return false;
  }
  return /\b(remember|save (?:this|that)|don't forget|keep in mind|note that)\b/i.test(value);
}

export function rollupReason(input: {
  projectId: string | null;
  leaving: boolean;
  userTurns: number;
  userText: string;
}): RollupReason | null {
  if (!input.projectId || input.userTurns === 0) return null;
  if (input.leaving) return "close";
  if (explicitRequest(input.userText)) return "explicit";
  return input.userTurns % 10 === 0 ? "interval" : null;
}

export function rollupTranscript(messages: Message[], maxChars = 12_000): string {
  const lines = messages
    .filter((message) => message.role === "user" || message.role === "assistant")
    .map((message) => {
      const content = message.content.replace(/\s+/g, " ").trim();
      return content ? `${message.role === "user" ? "User" : "Assistant"}: ${content}` : "";
    })
    .filter(Boolean);
  const kept: string[] = [];
  let chars = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    const cost = line.length + (kept.length > 0 ? 2 : 0);
    if (chars + cost > maxChars) break;
    kept.unshift(line);
    chars += cost;
  }
  return kept.join("\n\n");
}

export function uniqueRollupNotes(notes: string[], existing: string[]): string[] {
  const seen = new Set(existing.map((text) => text.replace(/\s+/g, " ").trim().toLowerCase()));
  return notes.filter((note) => {
    const key = note.replace(/\s+/g, " ").trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
