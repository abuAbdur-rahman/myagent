import type { Memory, Project } from "./types";

const MAX_MEMORIES = 24;
const MAX_CHARS = 6000;

export interface ContextInput {
  globalMemories: Memory[];
  project: Project | null;
  projectMemories: Memory[];
}

function renderMemories(memories: Memory[]): string {
  return memories
    .slice(0, MAX_MEMORIES)
    .map((memory) => `- (${memory.kind}) ${memory.content.trim()}`)
    .filter((line) => line.length > `- (${"note"}) `.length)
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
