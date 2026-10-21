import { useApp } from "../lib/store";
import { activityState } from "../lib/activity";
import { cn } from "../lib/utils";

const LABELS = {
  thinking: "Thinking",
  writing: "Writing",
  compacting: "Compacting",
} as const;

export function ActivityPill({ placement }: { placement: "center" | "inline" }) {
  const { messages, streaming, compacting } = useApp();
  const state = compacting ? "compacting" : activityState(messages, streaming);
  if (state === null) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "pointer-events-none flex items-center gap-2 rounded-full border border-border bg-surface-2/95 px-3 py-1 text-xs text-muted shadow-[var(--shadow)] backdrop-blur",
        placement === "center"
          ? "absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
          : "mx-auto w-fit",
      )}
    >
      <span className="font-medium text-text">{LABELS[state]}</span>
      <span className="pill-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span className="pill-ellipsis" aria-hidden="true">
        …
      </span>
    </div>
  );
}
