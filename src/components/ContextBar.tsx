import { useApp } from "../lib/store";
import { estimateContext } from "../lib/context";
import { cn } from "../lib/utils";
import { Button } from "./ui";

export function ContextBar() {
  const {
    messages,
    conversations,
    activeConversationId,
    streaming,
    compactActive,
    uncompactActive,
  } = useApp();

  const conversation = conversations.find((c) => c.id === activeConversationId) ?? null;
  if (!conversation || messages.length === 0) return null;

  if (conversation.compacted === 1) {
    return (
      <div className="mb-1.5 flex items-center gap-2.5 px-1 text-xs text-muted">
        <span>Compacted — only recent messages are sent</span>
        <span className="flex-1" />
        <Button size="sm" variant="default" onClick={() => void uncompactActive()}>
          Show all
        </Button>
      </div>
    );
  }

  const info = estimateContext(messages, null);
  const tone = info.pct > 90 ? "danger" : info.pct > 70 ? "warn" : "";

  return (
    <div className="mb-1.5 flex items-center gap-2.5 px-1 text-xs text-muted">
      <span className={cn(tone === "danger" && "text-danger", tone === "warn" && "text-warn")}>
        Context {info.pct}% used
      </span>
      <div className="h-1 max-w-[240px] flex-1 overflow-hidden rounded bg-active">
        <div
          className={cn(
            "h-full",
            tone === "danger" ? "bg-danger" : tone === "warn" ? "bg-warn" : "bg-accent",
          )}
          style={{ width: `${info.pct}%` }}
        />
      </div>
      <span className="flex-1" />
      <Button
        size="sm"
        variant="default"
        disabled={streaming || messages.length < 3}
        onClick={() => void compactActive()}
      >
        Compact
      </Button>
    </div>
  );
}
