import {
  declaredArtifactSchema,
  toolLogEntrySchema,
  type DeclaredArtifact,
  type Message,
  type ToolLogEntry,
} from "./types";

export function parseDeclaredArtifacts(raw: unknown): DeclaredArtifact[] {
  if (typeof raw !== "string") return [];
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    console.warn("parseDeclaredArtifacts: invalid JSON, dropping artifacts");
    return [];
  }
  if (!Array.isArray(value)) return [];
  const artifacts: DeclaredArtifact[] = [];
  for (const entry of value) {
    const parsed = declaredArtifactSchema.safeParse(entry);
    if (parsed.success) artifacts.push(parsed.data);
  }
  return artifacts;
}

export function parseToolLog(raw: unknown): ToolLogEntry[] {
  if (typeof raw !== "string" && !Array.isArray(raw)) return [];
  let value: unknown = raw;
  if (typeof raw === "string") {
    if (!raw) return [];
    try {
      value = JSON.parse(raw);
    } catch {
      console.warn("parseToolLog: invalid JSON, dropping tool log");
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const entries: ToolLogEntry[] = [];
  for (const entry of value) {
    const parsed = toolLogEntrySchema.safeParse(entry);
    if (parsed.success) entries.push(parsed.data);
  }
  return entries;
}

function newestUnique(entries: ToolLogEntry[], limit: number): ToolLogEntry[] {
  const seen = new Set<string>();
  return entries
    .slice()
    .reverse()
    .filter((entry) => {
      const key = `${entry.name}\n${entry.summary}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit)
    .reverse();
}

export function continueDigest(entries: ToolLogEntry[]): string {
  const recent = entries.slice(-10);
  const done = newestUnique(
    recent.filter((entry) => entry.status === "ok"),
    6,
  ).map((entry) => {
    const preview = entry.preview?.trim();
    return `- ${entry.name}: ${entry.summary}${preview ? `\n  ${preview.slice(0, 300)}` : ""}`;
  });
  const failed = newestUnique(
    recent.filter((entry) => entry.status === "err"),
    3,
  ).map((entry) => `- ${entry.name}: ${entry.summary}`);
  const doneBlock = done.length > 0 ? `\n\nAlready done this turn (do not repeat):\n${done.join("\n")}` : "";
  const failedBlock =
    failed.length > 0
      ? `\n\nRecent failures (retry differently if needed):\n${failed.join("\n")}`
      : "";
  return `${doneBlock}${failedBlock}`;
}

export interface LiveTurnDraft {
  assistantId: string;
  content: string;
  reasoning: string;
  thinkingMs: number | null;
  finishReason: string | null;
  toolLog: ToolLogEntry[];
  artifacts: DeclaredArtifact[];
  error: string | null;
}

export function withLiveTurn(messages: Message[], draft: LiveTurnDraft): Message[] {
  const index = messages.findIndex((message) => message.id === draft.assistantId);
  if (index < 0) return messages;
  const next = [...messages];
  next[index] = {
    ...next[index],
    content: draft.content,
    reasoning: draft.reasoning,
    thinking_ms: draft.thinkingMs,
    finish_reason: draft.finishReason,
    tool_log: draft.toolLog.length > 0 ? JSON.stringify(draft.toolLog) : null,
    artifacts: draft.artifacts.length > 0 ? JSON.stringify(draft.artifacts) : null,
    error: draft.error,
  };
  return next;
}
