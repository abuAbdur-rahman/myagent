import { parseToolLog } from "./message-parse";
import type { Message } from "./types";

export type RollupReason = "close" | "explicit" | "interval";

const UNTRUSTED_TOOLS: ReadonlySet<string> = new Set([
  "web_search",
  "web_fetch",
  "research_run",
  "run_powershell",
  "sandbox_run",
  "sandbox_read",
  "sandbox_glob",
  "sandbox_grep",
  "read_document",
  "describe_image",
  "delegate_task",
]);

function toolNames(message: Message): string[] {
  return parseToolLog(message.tool_log).map((entry) => entry.name);
}

export function hasUntrustedProvenance(messages: Message[]): boolean {
  return messages.some((message) =>
    toolNames(message).some(
      (name) => UNTRUSTED_TOOLS.has(name) || name.startsWith("mcp__"),
    ),
  );
}

function personScoped(note: string): boolean {
  const value = note.trim();
  return (
    /^(the |this )?(user|person|persona|author)\b/i.test(value) ||
    /\bthe user('s)?\b/i.test(value) ||
    /^(i|i'm|i've|i'd|i'll|my|me|mine)\b/i.test(value) ||
    /^you(r)?\b/i.test(value)
  );
}

export function projectScopedNotes(notes: string[]): string[] {
  return notes.filter((note) => !personScoped(note));
}

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
