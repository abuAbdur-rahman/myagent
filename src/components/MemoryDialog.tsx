import { useCallback, useEffect, useState } from "react";
import { useApp } from "../lib/store";
import type { Memory } from "../lib/types";
import { MemoryEditor } from "./MemoryEditor";
import { Dialog } from "./ui";

export function MemoryDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { loadMemories, addMemory, editMemory, deleteMemory } = useApp();
  const [memories, setMemories] = useState<Memory[]>([]);

  const reload = useCallback(async () => {
    setMemories(await loadMemories("global", null));
  }, [loadMemories]);

  useEffect(() => {
    if (open) void reload();
  }, [open, reload]);

  return (
    <Dialog open={open} onClose={onClose} title="Global memory">
      <p className="mb-3 text-xs text-text-muted">
        These notes are sent with every chat, in every project. Open a project to
        keep memory scoped to it instead.
      </p>
      <MemoryEditor
        memories={memories}
        emptyHint="No global memory yet."
        onAdd={async (draft) => {
          await addMemory({ scope: "global", project_id: null, ...draft });
          await reload();
        }}
        onUpdate={async (id, draft) => {
          await editMemory(id, draft);
          await reload();
        }}
        onDelete={async (id) => {
          await deleteMemory(id);
          await reload();
        }}
      />
    </Dialog>
  );
}
