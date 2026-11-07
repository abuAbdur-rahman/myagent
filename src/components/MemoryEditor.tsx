import { useRef, useState } from "react";
import {
  MEMORY_KINDS,
  memoryDraftSchema,
  type Memory,
  type MemoryDraft,
} from "../lib/types";
import { Pencil, Trash2 } from "lucide-react";
import { Button, IconButton, Textarea } from "./ui";
import { Markdown } from "./Markdown";
import { Select } from "./ui/select";
import { confirmDialog } from "./ConfirmDialog";
import { errorText } from "../lib/utils";

const SNIPPET_MAX = 80;

function snippet(content: string): string {
  const flat = content.replace(/\s+/g, " ").trim();
  const chars = Array.from(flat);
  return chars.length > SNIPPET_MAX ? `${chars.slice(0, SNIPPET_MAX).join("")}…` : flat;
}

function KindChip({ kind }: { kind: string }) {
  return (
    <span className="rounded-chip bg-fill-2 px-1.5 py-0.5 text-[11px] uppercase tracking-[0.04em] text-fg-3">
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
  meta,
}: {
  memories: Memory[];
  emptyHint: string;
  onAdd: (draft: MemoryDraft) => Promise<void>;
  onUpdate: (id: string, draft: MemoryDraft) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  meta?: (memory: Memory) => string;
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
    <div className="flex flex-col gap-2">
      <div className="rounded-field bg-fill-1 p-2.5">
        <div className="mb-1.5 flex items-center gap-2">
          <KindSelect value={kind} onChange={setKind} label="New memory kind" />
          <span className="text-xs text-fg-3">
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
        <div className="mt-1.5 flex items-center justify-between">
          <span className="text-xs text-danger" role="alert">
            {addError}
          </span>
          <Button size="sm" onClick={() => void add()} disabled={busy}>
            Add memory
          </Button>
        </div>
      </div>

      {deleteError && (
        <p className="text-xs text-danger" role="alert">
          {deleteError}
        </p>
      )}

      <div className="flex flex-col">
        {memories.length === 0 && <p className="py-3 text-xs text-fg-3">{emptyHint}</p>}
        {memories.map((memory) => (
          <div
            key={memory.id}
            className="group border-t border-line-subtle py-2.5 first:border-t-0"
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
                  <span className="block text-xs text-danger" role="alert">
                    {editError}
                  </span>
                )}
              </div>
            ) : (
              <>
                <div className="flex items-center gap-1.5">
                  <KindChip kind={memory.kind} />
                  {meta && <span className="text-xs text-text-off">{meta(memory)}</span>}
                  <span className="flex-1" />
                  <div className="flex opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                    <IconButton
                      label="Edit memory"
                      size={24}
                      onClick={() => startEdit(memory)}
                      disabled={rowLocked}
                    >
                      <Pencil size={14} />
                    </IconButton>
                    <IconButton
                      label="Delete memory"
                      size={24}
                      onClick={() => void remove(memory)}
                      disabled={rowLocked}
                    >
                      <Trash2 size={14} />
                    </IconButton>
                  </div>
                </div>
                <div className="mt-1 text-fg-2">
                  <Markdown content={memory.content} compact />
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
