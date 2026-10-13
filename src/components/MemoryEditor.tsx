import { useState } from "react";
import {
  MEMORY_KINDS,
  memoryDraftSchema,
  type Memory,
  type MemoryDraft,
} from "../lib/types";
import { Button, Select, Textarea } from "./ui";
import { cn } from "../lib/utils";

function KindChip({ kind }: { kind: string }) {
  return (
    <span className="rounded-control bg-vault-raised px-1.5 py-0.5 text-xs uppercase tracking-wide text-text-muted">
      {kind}
    </span>
  );
}

function KindSelect({
  value,
  onChange,
  label,
}: {
  value: MemoryDraft["kind"];
  onChange: (kind: MemoryDraft["kind"]) => void;
  label: string;
}) {
  return (
    <Select
      className="w-32"
      value={value}
      onChange={(e) => onChange(e.target.value as MemoryDraft["kind"])}
      aria-label={label}
    >
      {MEMORY_KINDS.map((k) => (
        <option key={k} value={k}>
          {k}
        </option>
      ))}
    </Select>
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
  const [addError, setAddError] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editKind, setEditKind] = useState<MemoryDraft["kind"]>("fact");
  const [editError, setEditError] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);

  const add = async () => {
    const parsed = memoryDraftSchema.safeParse({ content: content.trim(), kind });
    if (!parsed.success) {
      setAddError(parsed.error.issues[0]?.message ?? "Invalid memory");
      return;
    }
    setBusy(true);
    try {
      await onAdd(parsed.data);
      setAddError(null);
      setContent("");
      setKind("fact");
    } catch (e) {
      setAddError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const startEdit = (memory: Memory) => {
    setEditingId(memory.id);
    setEditContent(memory.content);
    setEditKind(memory.kind);
    setEditError(null);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const parsed = memoryDraftSchema.safeParse({ content: editContent.trim(), kind: editKind });
    if (!parsed.success) {
      setEditError(parsed.error.issues[0]?.message ?? "Invalid memory");
      return;
    }
    setBusy(true);
    try {
      await onUpdate(editingId, parsed.data);
      setEditError(null);
      setEditingId(null);
      setEditContent("");
    } catch (e) {
      setEditError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await onDelete(id);
      setAddError(null);
    } catch (e) {
      setAddError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="rounded-control border border-vault-line p-3">
        <div className="mb-2 flex items-center gap-2">
          <KindSelect value={kind} onChange={setKind} label="New memory kind" />
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
            {addError}
          </span>
          <Button size="sm" onClick={() => void add()} disabled={busy}>
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
                <div className="flex items-center justify-between gap-2">
                  <KindSelect value={editKind} onChange={setEditKind} label="Memory kind" />
                  <div className="flex gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={() => void saveEdit()} disabled={busy}>
                      Save
                    </Button>
                  </div>
                </div>
                {editError && (
                  <span className="block text-xs text-alarm" role="status">
                    {editError}
                  </span>
                )}
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
                    onClick={() => void remove(memory.id)}
                    disabled={busy}
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
