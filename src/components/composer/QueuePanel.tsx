import { useState } from "react";
import { ChevronDown, ChevronUp, GripVertical, Pencil, Send, X } from "lucide-react";

import { cn } from "../../lib/utils";
import { queuePreview } from "./queue";

export function QueuePanel({
  items,
  collapsed,
  onToggle,
  onEdit,
  onSend,
  onRemove,
  onMove,
}: {
  items: { id: string; text: string }[];
  collapsed: boolean;
  onToggle: () => void;
  onEdit: (id: string) => void;
  onSend: (id: string) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, toIndex: number) => void;
}) {
  const [dragging, setDragging] = useState<string | null>(null);

  if (items.length === 0) return null;

  return (
    <div className="mb-2 overflow-hidden rounded-panel border border-line bg-surface-2">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-fg-2 hover:bg-fill-1"
      >
        <span className="font-medium">Queued messages</span>
        <span className="rounded-full bg-fill-2 px-1.5 text-xs tabular-nums text-fg-3">
          {items.length}
        </span>
        <span className="flex-1" />
        {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
      </button>
      {!collapsed && (
        <ul className="m-0 list-none border-t border-line p-0">
          {items.map((item, index) => (
            <li
              key={item.id}
              draggable
              onDragStart={(event) => {
                setDragging(item.id);
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", item.id);
              }}
              onDragEnd={() => setDragging(null)}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const id = dragging ?? event.dataTransfer.getData("text/plain");
                setDragging(null);
                if (id && id !== item.id) onMove(id, index);
              }}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 text-[13px] text-fg-2",
                dragging === item.id ? "opacity-60" : "hover:bg-fill-1",
              )}
            >
              <GripVertical size={14} className="flex-none cursor-grab text-text-off" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate" title={item.text}>
                {queuePreview(item.text)}
              </span>
              <button
                type="button"
                onClick={() => onEdit(item.id)}
                aria-label="Edit queued message"
                title="Edit"
                className="flex-none rounded p-1 text-fg-3 hover:bg-fill-2 hover:text-fg"
              >
                <Pencil size={14} />
              </button>
              <button
                type="button"
                onClick={() => onSend(item.id)}
                aria-label="Send queued message next"
                title="Send next"
                className="flex-none rounded p-1 text-fg-3 hover:bg-fill-2 hover:text-fg"
              >
                <Send size={14} />
              </button>
              <button
                type="button"
                onClick={() => onRemove(item.id)}
                aria-label="Remove queued message"
                title="Remove"
                className="flex-none rounded p-1 text-fg-3 hover:bg-fill-2 hover:text-fg"
              >
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
