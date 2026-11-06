import { useEffect, useState } from "react";
import { Loader2, Mic } from "lucide-react";
import { useApp } from "../lib/store";
import { elapsedLabel, pillState, toolActivityLabel, type PillState } from "../lib/activity";
import { cn } from "../lib/utils";

const LABELS: Record<PillState, string> = {
  thinking: "Thinking",
  writing: "Writing",
  compacting: "Compacting",
  starting: "Starting microphone",
  recording: "Listening",
  transcribing: "Transcribing",
};

const HINTS: Partial<Record<PillState, string>> = {
  starting: "keep holding",
  recording: "release to send",
};

export function ActivityPill({ placement }: { placement: "center" | "inline" }) {
  const { messages, streaming, compacting, voicePhase, activeTool, activeStep, turnStartedAt } =
    useApp();
  const state = pillState({ messages, streaming, compacting, voice: voicePhase });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (state === null) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [state, turnStartedAt]);

  if (state === null) return null;

  const elapsed = elapsedLabel(turnStartedAt, now);

  const voice = state === "starting" || state === "recording" || state === "transcribing";
  const toolLabel =
    state === "thinking" || state === "writing" ? toolActivityLabel(activeTool) : null;
  const label = toolLabel ?? LABELS[state];

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
      <span className="font-medium text-text">{label}</span>
      {activeStep !== null && state !== "writing" ? (
        <span>
          step {activeStep.step}/{activeStep.max}
        </span>
      ) : null}
      {elapsed ? <span>{elapsed}</span> : null}
      {HINTS[state] && <span>{HINTS[state]}</span>}
      {state === "recording" ? (
        <span className="size-1.5 animate-pulse rounded-full bg-danger" aria-hidden="true" />
      ) : state === "starting" || state === "transcribing" ? (
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
