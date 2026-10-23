import { Loader2, Mic } from "lucide-react";
import { useApp } from "../lib/store";
import { pillState, type PillState } from "../lib/activity";
import { cn } from "../lib/utils";

const LABELS: Record<PillState, string> = {
  thinking: "Thinking",
  writing: "Writing",
  compacting: "Compacting",
  recording: "Listening",
  transcribing: "Transcribing",
};

const HINTS: Partial<Record<PillState, string>> = {
  recording: "release to send",
};

export function ActivityPill({ placement }: { placement: "center" | "inline" }) {
  const { messages, streaming, compacting, voicePhase } = useApp();
  const state = pillState({ messages, streaming, compacting, voice: voicePhase });
  if (state === null) return null;

  const voice = state === "recording" || state === "transcribing";

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
      {voice ? (
        <Mic size={13} className={state === "recording" ? "text-danger" : undefined} aria-hidden="true" />
      ) : null}
      <span className="font-medium text-text">{LABELS[state]}</span>
      {HINTS[state] && <span>{HINTS[state]}</span>}
      {state === "recording" ? (
        <span className="size-1.5 animate-pulse rounded-full bg-danger" aria-hidden="true" />
      ) : state === "transcribing" ? (
        <Loader2 size={12} className="animate-spin" aria-hidden="true" />
      ) : (
        <>
          <span className="pill-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span className="pill-ellipsis" aria-hidden="true">
            …
          </span>
        </>
      )}
    </div>
  );
}
