import type { Memory, Project } from "./types";
import { toolListSentence } from "./tools";

const MAX_MEMORIES = 24;
const MAX_CHARS = 6000;
const DEFAULT_MODEL_CONTEXT = 128_000;
const COMPACT_WINDOW = 4;
const MAX_TURNS_WINDOW = 60;

export interface ContextInput {
  globalMemories: Memory[];
  project: Project | null;
  projectMemories: Memory[];
  userName?: string;
}

const IDENTITY_LINES = [
  "You are the assistant inside MyAgent, a local-first Windows desktop chat app.",
  "The user's API keys and chats never leave this machine; there is no cloud account.",
  "Answer with Markdown. Wrap code in fenced blocks with a language tag.",
  "For an interactive deliverable, emit ONE fenced html block with a complete self-contained page; it opens in a preview pane.",
  "A standalone reusable deliverable over ~50 lines is an artifact: call save_artifact with a title, language tag, and the complete content instead of pasting it. It opens beside the chat as a file card. Short snippets stay inline as fenced code.",
  "Durable user facts use short lines; the client stores and re-sends them, so never invent memories.",
  `You can act through tools when the user asks for action: ${toolListSentence()}. Prefer acting over asking; say briefly what you did.`,
];

function renderMemories(memories: Memory[]): string {
  return memories
    .slice(0, MAX_MEMORIES)
    .map((memory) => ({ kind: memory.kind, content: memory.content.trim() }))
    .filter(({ content }) => content.length > 0)
    .map(({ kind, content }) => `- (${kind}) ${content}`)
    .join("\n");
}

export function buildSystemPrompt(input: ContextInput): string | null {
  const blocks: string[] = [
    input.userName?.trim()
      ? `${IDENTITY_LINES[0]} The user's name is ${input.userName.trim()}.`
      : IDENTITY_LINES[0],
    ...IDENTITY_LINES.slice(1),
  ];

  const global = renderMemories(input.globalMemories);
  if (global) {
    blocks.push(`## Durable memory\n${global}`);
  }

  if (input.project) {
    const parts: string[] = [`## Project: ${input.project.name}`];
    const description = input.project.description.trim();
    const instructions = input.project.instructions.trim();
    const projectMemory = renderMemories(input.projectMemories);

    if (description) parts.push(description);
    if (instructions) parts.push(`### Project instructions\n${instructions}`);
    if (projectMemory) parts.push(`### Project memory\n${projectMemory}`);

    if (parts.length > 1) {
      blocks.push(parts.join("\n\n"));
    }
  }

  if (blocks.length === 0) return null;

  return blocks.join("\n\n").slice(0, MAX_CHARS);
}

export function applyCompactWindow<T extends { content: string }>(turns: T[], compacted: boolean): T[] {
  if (compacted) return turns.slice(-COMPACT_WINDOW);
  if (turns.length > MAX_TURNS_WINDOW) return turns.slice(-MAX_TURNS_WINDOW);
  return turns;
}

export interface SummaryWindow {
  summary: string | null;
  through: number | null;
}

export function applySummaryWindow<
  T extends { content: string; created_at?: number },
>(turns: T[], window: SummaryWindow): T[] {
  let kept = turns;
  if (window.summary && window.through !== null) {
    const through: number = window.through;
    kept = turns.filter((turn) => (turn.created_at ?? Number.MAX_SAFE_INTEGER) > through);
  }
  if (kept.length > MAX_TURNS_WINDOW) return kept.slice(-MAX_TURNS_WINDOW);
  return kept;
}

export function summarySystemTurn(summary: string): { role: string; content: string } {
  return {
    role: "system",
    content: `Earlier conversation summary (older messages omitted):\n${summary}`,
  };
}

export function estimateContext(
  turns: { content: string }[],
  system: string | null,
  limit = DEFAULT_MODEL_CONTEXT,
): { tokens: number; limit: number; pct: number } {
  const chars =
    (system ?? "").length + turns.reduce((sum, turn) => sum + turn.content.length, 0);
  const tokens = Math.round(chars / 4);
  const pct = Math.min(100, Math.round((tokens / limit) * 100));
  return { tokens, limit, pct };
}
