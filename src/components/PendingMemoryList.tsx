import { useState } from "react";
import type { PendingMemory } from "../lib/types";
import { useApp } from "../lib/store";
import { Button } from "./ui";

export function PendingMemoryList({
  rows,
  compact = false,
  onChanged,
}: {
  rows: PendingMemory[];
  compact?: boolean;
  onChanged?: () => void;
}) {
  const { approvePendingMemory, dismissPendingMemory } = useApp();
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (rows.length === 0) return null;

  const run = async (id: string, action: () => Promise<void>) => {
    setBusy(id);
    setError(null);
    try {
      await action();
      setEditing(null);
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-1.5">
      {rows.map((memory) => (
        <div
          key={memory.id}
          className={
            compact
              ? "rounded-control border border-border px-2.5 py-2"
              : "rounded-control border border-border px-3 py-2"
          }
        >
          <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
            <span className="rounded-full bg-hover px-1.5 py-0.5">
              {memory.kind}
            </span>
            <span>
              {memory.scope === "global" ? "Every chat" : "This project"}
            </span>
            {memory.trust === "untrusted" && (
              <span className="rounded-full bg-warn/15 px-1.5 py-0.5 font-medium text-warn">
                Web or document
              </span>
            )}
          </div>
          {editing === memory.id ? (
            <textarea
              className="w-full rounded-control border border-border bg-transparent px-2 py-1 text-sm"
              rows={3}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
            />
          ) : (
            <p className="whitespace-pre-wrap text-sm">{memory.content}</p>
          )}
          <div className="mt-1.5 flex justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              disabled={busy !== null}
              onClick={() =>
                void run(memory.id, () => dismissPendingMemory(memory.id))
              }
            >
              Skip
            </Button>
            {editing === memory.id ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  disabled={busy !== null || draft.trim().length === 0}
                  onClick={() =>
                    void run(memory.id, () =>
                      approvePendingMemory(memory.id, draft),
                    )
                  }
                >
                  Save
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => {
                    setEditing(memory.id);
                    setDraft(memory.content);
                  }}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  disabled={busy !== null}
                  onClick={() =>
                    void run(memory.id, () => approvePendingMemory(memory.id))
                  }
                >
                  Save
                </Button>
              </>
            )}
          </div>
        </div>
      ))}
      {error && (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
