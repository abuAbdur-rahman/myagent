import { useApp } from "../lib/store";
import { Button } from "./ui";
import { cn } from "../lib/utils";

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return `${tokens}`;
}

export function ContextBar() {
  const {
    messages,
    conversations,
    activeConversationId,
    streaming,
    compactActive,
    uncompactActive,
    contextInfo,
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

  const { tokens, limit, pct, real, lastIn, lastOut } = contextInfo;

  let labelClass = "";
  if (pct > 90) {
    labelClass = "text-danger";
  } else if (pct > 70) {
    labelClass = "text-warn";
  }

  let fillClass = "bg-accent";
  if (pct > 90) {
    fillClass = "bg-danger";
  } else if (pct > 70) {
    fillClass = "bg-warn";
  }

  const title = real
    ? `${formatTokens(tokens)} / ${formatTokens(limit)} tokens (provider-reported)`
    : `≈ ${formatTokens(tokens)} / ${formatTokens(limit)} tokens (chars/4 estimate)`;

  return (
    <div
      className="mb-1.5 flex items-center gap-2.5 px-1 text-xs text-muted"
      title={title}
    >
      <span className={cn(labelClass)}>
        Context {pct}% used{real ? "" : " (est.)"}
        {real && lastIn !== null && lastOut !== null
          ? ` · ↑${formatTokens(lastIn)} ↓${formatTokens(lastOut)}`
          : ""}
      </span>
      <div className="h-1 max-w-[240px] flex-1 overflow-hidden rounded bg-active">
        <div className={cn("h-full", fillClass)} style={{ width: `${pct}%` }} />
      </div>
      <span className="flex-1" />
      <Button
        size="sm"
        variant="default"
        disabled={streaming || messages.length <= 4}
        onClick={() => void compactActive()}
      >
        Compact
      </Button>
    </div>
  );
}
