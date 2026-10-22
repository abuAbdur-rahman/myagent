import type { Memory, PendingMemory } from "./types";

interface MemoryExportNote {
  content: string;
  kind: string;
  scope: string;
  source_chat: string | null;
}

interface SavedExport extends MemoryExportNote {
  created: string;
}

interface PendingExport extends MemoryExportNote {
  queued: string;
}

interface MemoryExportFile {
  exported_at: string;
  saved: SavedExport[];
  pending: PendingExport[];
}

export function memoryMatches(memory: Memory, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [memory.content, memory.kind, memory.scope].some((field) =>
    field.toLowerCase().includes(needle),
  );
}

export function filterMemories(memories: Memory[], query: string): Memory[] {
  return memories.filter((memory) => memoryMatches(memory, query));
}

function memoryExport(
  memories: Memory[],
  pending: PendingMemory[],
  chatTitle: (conversationId: string | null) => string | null,
  now: Date = new Date(),
): MemoryExportFile {
  return {
    exported_at: now.toISOString(),
    saved: memories.map((memory) => ({
      content: memory.content,
      kind: memory.kind,
      scope: memory.scope,
      source_chat: chatTitle(memory.source_conversation_id ?? null),
      created: new Date(memory.created_at).toISOString(),
    })),
    pending: pending.map((item) => ({
      content: item.content,
      kind: item.kind,
      scope: item.scope,
      source_chat: chatTitle(item.conversation_id),
      queued: new Date(item.created_at).toISOString(),
    })),
  };
}

export function memoryJson(
  memories: Memory[],
  pending: PendingMemory[],
  chatTitle: (conversationId: string | null) => string | null,
  now: Date = new Date(),
): string {
  return JSON.stringify(memoryExport(memories, pending, chatTitle, now), null, 2);
}
