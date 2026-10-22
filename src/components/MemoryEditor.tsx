import { useRef, useState } from "react";
import {
  MEMORY_KINDS,
  memoryDraftSchema,
  type Memory,
  type MemoryDraft,
} from "../lib/types";
import { Button, Textarea } from "./ui";
import { Select } from "./ui/select";
import { confirmDialog } from "./ConfirmDialog";
import { cn, errorText } from "../lib/utils";

const SNIPPET_MAX = 80;

function snippet(content: string): string {
  const flat = content.replace(/\s+/g, " ").trim();
  const chars = Array.from(flat);
  return chars.length > SNIPPET_MAX ? `${chars.slice(0, SNIPPET_MAX).join("")}…` : flat;
}

export function KindChip({ kind }: { kind: string }) {
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
      size="sm"
      className="w-32"
      value={value}
      onChange={(kind) => onChange(kind)}
      aria-label={label}
      options={MEMORY_KINDS.map((k) => ({ value: k, label: k }))}
    />
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

  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const rowLocked = busy || confirmingId !== null;

  const parseDraft = (
    rawContent: string,
    rawKind: MemoryDraft["kind"],
    setError: (message: string) => void,
  ): MemoryDraft | null => {
    const parsed = memoryDraftSchema.safeParse({ content: rawContent.trim(), kind: rawKind });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? "Invalid memory");
      return null;
    }
    return parsed.data;
  };

  const runLocked = async (
    setError: (message: string | null) => void,
    task: () => Promise<boolean>,
  ) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const ok = await task();
      if (ok) setError(null);
    } catch (e) {
      setError(errorText(e));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const add = () =>
    runLocked(setAddError, async () => {
      const draft = parseDraft(content, kind, setAddError);
      if (!draft) return false;
      await onAdd(draft);
      setDeleteError(null);
      setContent("");
      setKind("fact");
      return true;
    });

  const startEdit = (memory: Memory) => {
    if (busyRef.current) return;
    setEditingId(memory.id);
    setEditContent(memory.content);
    setEditKind(memory.kind);
    setEditError(null);
  };

  const cancelEdit = () => {
    if (busyRef.current) return;
    setEditingId(null);
    setEditError(null);
  };

  const saveEdit = () => {
    const id = editingId;
    if (!id) return Promise.resolve();
    return runLocked(setEditError, async () => {
      const draft = parseDraft(editContent, editKind, setEditError);
      if (!draft) return false;
      await onUpdate(id, draft);
      setDeleteError(null);
      setEditingId(null);
      setEditContent("");
      return true;
    });
  };

  const remove = async (memory: Memory) => {
    if (busyRef.current) return;
    if (confirmingId) return;
    setConfirmingId(memory.id);
    try {
      const confirmed = await confirmDialog({
        title: "Delete this memory?",
        body: `"${snippet(memory.content)}" will be removed. This cannot be undone.`,
        ok: "Delete",
        danger: true,
      });
      if (!confirmed) return;
      await runLocked(setDeleteError, async () => {
        await onDelete(memory.id);
        return true;
      });
    } finally {
      setConfirmingId(null);
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
          <span className="text-xs text-alarm" role="alert">
            {addError}
          </span>
          <Button size="sm" onClick={() => void add()} disabled={busy}>
            Add memory
          </Button>
        </div>
      </div>

      {deleteError && (
        <p className="text-xs text-alarm" role="alert">
          {deleteError}
        </p>
      )}

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
                    <Button variant="ghost" size="sm" onClick={cancelEdit} disabled={busy}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={() => void saveEdit()} disabled={busy}>
                      Save
                    </Button>
                  </div>
                </div>
                {editError && (
                  <span className="block text-xs text-alarm" role="alert">
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
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => startEdit(memory)}
                    disabled={rowLocked}
                  >
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void remove(memory)}
                    disabled={rowLocked}
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
