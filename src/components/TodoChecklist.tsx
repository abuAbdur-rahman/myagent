import { useState } from "react";
import { Check, ChevronDown, ChevronUp, Circle, CircleDot, X } from "lucide-react";
import { useApp } from "../lib/store";
import { cn } from "../lib/utils";
import type { TodoStatus } from "../lib/types";

function StatusIcon({ status }: { status: TodoStatus }) {
  const props = { size: 14 } as const;
  switch (status) {
    case "completed":
      return <Check {...props} className="text-success" />;
    case "in_progress":
      return <CircleDot {...props} className="text-accent" />;
    case "cancelled":
      return <X {...props} className="text-muted" />;
    default:
      return <Circle {...props} className="text-muted" />;
  }
}

export function TodoChecklist() {
  const { todos, activeConversationId } = useApp();
  const [collapsed, setCollapsed] = useState(false);

  if (!activeConversationId || todos.length === 0) return null;

  const done = todos.filter((todo) => todo.status === "completed").length;
  const allDone = done === todos.length;

  return (
    <div className="mb-1.5 rounded-card border border-border bg-surface px-2.5 py-1.5">
      <button
        type="button"
        onClick={() => setCollapsed((prev) => !prev)}
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Show checklist" : "Hide checklist"}
        className="flex w-full items-center gap-2 text-left text-xs text-muted"
      >
        <span className="font-medium text-text">
          {done} of {todos.length} {todos.length === 1 ? "task" : "tasks"} done
        </span>
        <span className="flex-1" />
        {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
      </button>
      {!collapsed && (
        <ul role="list" className="m-0 mt-1.5 flex list-none flex-col gap-1 p-0">
          {todos.map((todo) => (
            <li key={todo.id} className="flex items-start gap-2 text-xs">
              <span className="mt-0.5 flex-none">
                <StatusIcon status={todo.status} />
              </span>
              <span
                className={cn(
                  "min-w-0 break-words",
                  (todo.status === "completed" || todo.status === "cancelled") &&
                    "text-muted line-through",
                  todo.status === "in_progress" && "text-text",
                )}
              >
                {todo.text}
              </span>
            </li>
          ))}
        </ul>
      )}
      {allDone && collapsed && <span className="sr-only">All tasks complete</span>}
    </div>
  );
}
