import { useState } from "react";
import { Brain } from "lucide-react";
import { useApp } from "../lib/store";
import { toast } from "../lib/toast";
import { Button } from "./ui";
import { PendingMemoryList } from "./PendingMemoryList";

export function pendingForConversation<T extends { conversation_id: string | null }>(
  rows: T[],
  conversationId: string | null,
): T[] {
  return rows.filter((row) => row.conversation_id === conversationId);
}

const VISIBLE = 3;

export function PendingMemoryBar({
  projectId,
  onChanged,
}: { projectId?: string; onChanged?: () => void } = {}) {
  const { pendingMemories, activeConversationId, setSettingsPage, approveAllPendingMemories } =
    useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rows = projectId
    ? pendingMemories.filter(
        (memory) => memory.scope === "project" && memory.project_id === projectId,
      )
    : pendingForConversation(pendingMemories, activeConversationId);

  if (rows.length === 0) return null;

  const shown = rows.slice(0, VISIBLE);
  const hidden = rows.length - shown.length;
  const acceptAll = async () => {
    setBusy(true);
    setError(null);
    try {
      await approveAllPendingMemories(rows);
      toast(`${rows.length} ${rows.length === 1 ? "memory" : "memories"} saved`);
      onChanged?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="mb-3 rounded-card border border-warn/40 bg-surface px-3 py-2"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center gap-2 text-xs font-medium">
        <Brain size={14} />
        <span>
          {rows.length === 1
            ? "Memory waiting for review"
            : `${rows.length} memories waiting for review`}
        </span>
        <span className="text-muted">Nothing is saved until you approve it.</span>
        {hidden > 0 && (
          <button
            type="button"
            className="ml-auto text-xs text-accent hover:underline"
            onClick={() => setSettingsPage("memory")}
          >
            {hidden} more in Settings
          </button>
        )}
        {rows.length > 1 && (
          <Button
            size="sm"
            className={hidden > 0 ? "" : "ml-auto"}
            disabled={busy}
            aria-label={`Accept all ${rows.length} pending ${rows.length === 1 ? "memory" : "memories"}`}
            onClick={() => void acceptAll()}
          >
            {busy ? "Saving…" : "Accept all"}
          </Button>
        )}
      </div>
      <div className="mt-2">
        <PendingMemoryList rows={shown} compact onChanged={onChanged} />
      </div>
      {error && (
        <p className="mt-1 text-xs text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
