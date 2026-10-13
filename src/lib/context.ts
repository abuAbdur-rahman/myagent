import type { Memory, Project } from "./types";

const MAX_MEMORIES = 24;
const MAX_CHARS = 6000;
const DEFAULT_MODEL_CONTEXT = 128_000;
const COMPACT_WINDOW = 4;

export interface ContextInput {
  globalMemories: Memory[];
  project: Project | null;
  projectMemories: Memory[];
}

function renderMemories(memories: Memory[]): string {
  return memories
    .slice(0, MAX_MEMORIES)
    .map((memory) => ({ kind: memory.kind, content: memory.content.trim() }))
    .filter(({ content }) => content.length > 0)
    .map(({ kind, content }) => `- (${kind}) ${content}`)
    .join("\n");
}

export function buildSystemPrompt(input: ContextInput): string | null {
  const blocks: string[] = [];

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
  if (!compacted) return turns;
  return turns.slice(-COMPACT_WINDOW);
}

export function estimateContext(
  turns: { content: string }[],
  system: string | null,
): { tokens: number; limit: number; pct: number } {
  const chars =
    (system ?? "").length + turns.reduce((sum, turn) => sum + turn.content.length, 0);
  const tokens = Math.round(chars / 4);
  const pct = Math.min(100, Math.round((tokens / DEFAULT_MODEL_CONTEXT) * 100));
  return { tokens, limit: DEFAULT_MODEL_CONTEXT, pct };
}
