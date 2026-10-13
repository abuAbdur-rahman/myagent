import { useApp } from "../lib/store";
import { buildSystemPrompt, COMPACT_WINDOW, estimateContext } from "../lib/context";
import { Button } from "./ui";
import { cn } from "../lib/utils";

export function ContextBar() {
  const {
    messages,
    conversations,
    activeConversationId,
    streaming,
    compactActive,
    uncompactActive,
    globalMemories,
    activeProject,
    projectMemories,
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

  const system = buildSystemPrompt({
    globalMemories,
    project: activeProject,
    projectMemories,
  });
  const info = estimateContext(messages, system);

  let tone = "";
  if (info.pct > 90) {
    tone = "danger";
  } else if (info.pct > 70) {
    tone = "warn";
  }

  let labelClass = "";
  if (tone === "danger") {
    labelClass = "text-danger";
  } else if (tone === "warn") {
    labelClass = "text-warn";
  }

  let fillClass = "bg-accent";
  if (tone === "danger") {
    fillClass = "bg-danger";
  } else if (tone === "warn") {
    fillClass = "bg-warn";
  }

  return (
    <div className="mb-1.5 flex items-center gap-2.5 px-1 text-xs text-muted">
      <span className={cn(labelClass)}>Context {info.pct}% used</span>
      <div className="h-1 max-w-[240px] flex-1 overflow-hidden rounded bg-active">
        <div className={cn("h-full", fillClass)} style={{ width: `${info.pct}%` }} />
      </div>
      <span className="flex-1" />
      <Button
        size="sm"
        variant="default"
        disabled={streaming || messages.length <= COMPACT_WINDOW}
        onClick={() => void compactActive()}
      >
        Compact
      </Button>
    </div>
  );
}
