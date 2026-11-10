import { parseToolLog } from "./message-parse";
import { parseMessageAttachments } from "./attachments";
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
  "conversation_search",
]);

function toolNames(message: Message): string[] {
  return parseToolLog(message.tool_log).map((entry) => entry.name);
}

export function hasUntrustedProvenance(messages: Message[]): boolean {
  return messages.some(
    (message) =>
      parseMessageAttachments(message.attachments).length > 0 ||
      toolNames(message).some(
        (name) => UNTRUSTED_TOOLS.has(name) || name.startsWith("mcp__"),
      ),
  );
}

function personScoped(note: string): boolean {
  const value = note.trim().replace(/’/g, "'");
  return (
    /^(the |this )?(user|person|persona|author)'s\b/i.test(value) ||
    /^(the |this )?(user|person|persona|author)\s+(prefers?|likes?|wants?|needs?|is|has|uses?|works?|lives?|can|cannot|does|doesn't)\b/i.test(
      value,
    ) ||
    /^(i|i'm|i've|i'd|i'll|my|me|mine)\b/i.test(value) ||
    /^you(r)?\b/i.test(value) ||
    /\b[A-Z][A-Za-z'-]*'s\s+(email|phone|address|birthday|location|account|name)\b/.test(
      value,
    ) ||
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i.test(value)
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
    if (chars + cost > maxChars) {
      if (kept.length === 0 && maxChars > 1) {
        kept.unshift(`${line.slice(0, maxChars - 1).trimEnd()}…`);
      }
      break;
    }
    kept.unshift(line);
    chars += cost;
  }
  return kept.join("\n\n");
}

export function uniqueRollupNotes(notes: string[], existing: string[]): string[] {
  const seen = existing.map((text) => text.replace(/\s+/g, " ").trim());
  return notes.filter((note) => {
    const key = note.replace(/\s+/g, " ").trim();
    if (!key || seen.some((text) => noteSimilarity(text, key) >= 0.8)) return false;
    seen.push(key);
    return true;
  });
}

function noteSimilarity(left: string, right: string): number {
  const negated = (text: string) =>
    /\b(not|never|no longer|no|cannot|can't|don't|doesn't|isn't|aren't|won't|shouldn't)\b/i.test(
      text,
    );
  if (negated(left) !== negated(right)) return 0;
  const tokens = (text: string) =>
    new Set(
      text
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((token) => token.length >= 3),
    );
  const a = tokens(left);
  const b = tokens(right);
  if (a.size === 0 || b.size === 0) return 0;
  const shared = [...a].filter((token) => b.has(token)).length;
  return shared / Math.min(a.size, b.size);
}
