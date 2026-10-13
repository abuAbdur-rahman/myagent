import { useState } from "react";
import { MEMORY_KINDS, memoryDraftSchema, type Memory, type MemoryDraft } from "../lib/types";
import { Button, Select, Textarea } from "./ui";
import { cn } from "../lib/utils";

function KindChip({ kind }: { kind: string }) {
  return (
    <span className="rounded-control bg-vault-raised px-1.5 py-0.5 text-xs uppercase tracking-wide text-text-muted">
      {kind}
    </span>
  );
}

export function MemoryEditor({
  memories,
  emptyHint,
  onAdd,
  onUpdate,
  onDelete,
}: {
  memories: Memory[];
  emptyHint: string;
  onAdd: (draft: MemoryDraft) => Promise<void>;
  onUpdate: (id: string, draft: MemoryDraft) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}) {
  const [content, setContent] = useState("");
  const [kind, setKind] = useState<MemoryDraft["kind"]>("fact");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [error, setError] = useState<string | null>(null);

  const add = async () => {
    const parsed = memoryDraftSchema.safeParse({ content: content.trim(), kind });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid memory");
      return;
    }
    setError(null);
    await onAdd(parsed.data);
    setContent("");
  };

  const startEdit = (memory: Memory) => {
    setEditingId(memory.id);
    setEditContent(memory.content);
    setKind(memory.kind);
    setError(null);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const parsed = memoryDraftSchema.safeParse({ content: editContent.trim(), kind });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid memory");
      return;
    }
    await onUpdate(editingId, parsed.data);
    setEditingId(null);
    setEditContent("");
    setError(null);
  };

  return (
    <div className="space-y-3">
      <div className="rounded-control border border-vault-line p-3">
        <div className="mb-2 flex items-center gap-2">
          <Select
            className="w-32"
            value={kind}
            onChange={(e) => setKind(e.target.value as MemoryDraft["kind"])}
            aria-label="Memory kind"
          >
            {MEMORY_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </Select>
          <span className="text-xs text-text-muted">
            A durable note the assistant should keep in mind.
          </span>
        </div>
        <Textarea
          rows={2}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="e.g. Always answer with TypeScript examples."
          aria-label="New memory"
        />
        <div className="mt-2 flex items-center justify-between">
          <span className="text-xs text-alarm" role="status">
            {error}
          </span>
          <Button size="sm" onClick={() => void add()}>
            Add memory
          </Button>
        </div>
      </div>

      <div className="space-y-1">
        {memories.length === 0 && <p className="px-1 py-3 text-xs text-text-faint">{emptyHint}</p>}
        {memories.map((memory) => (
          <div
            key={memory.id}
            className={cn(
              "rounded-control border border-vault-line px-3 py-2",
              editingId === memory.id && "bg-vault-surface/60",
            )}
          >
            {editingId === memory.id ? (
              <div className="space-y-2">
                <Textarea
                  rows={2}
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  aria-label="Edit memory"
                />
                <div className="flex justify-end gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={() => void saveEdit()}>
                    Save
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <KindChip kind={memory.kind} />
                  <p className="mt-1 whitespace-pre-wrap text-sm text-text-primary">
                    {memory.content}
                  </p>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button variant="ghost" size="sm" onClick={() => startEdit(memory)}>
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void onDelete(memory.id)}
                    aria-label="Delete memory"
                  >
                    Delete
                  </Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
