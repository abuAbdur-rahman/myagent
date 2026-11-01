import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Check, Loader2, TriangleAlert, X } from "lucide-react";
import * as api from "../lib/api";
import { errorText } from "../lib/utils";
import { Button } from "./ui";

type BuildEvent = { state: string; detail: string };

export function SandboxBuildStatus() {
  const [event, setEvent] = useState<BuildEvent | null>(null);
  const hideTimer = useRef<number | null>(null);

  useEffect(() => {
    let live = true;
    let unlisten: (() => void) | null = null;
    const scheduleHide = () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => {
        if (live) setEvent(null);
      }, 8000);
    };

    void listen<BuildEvent>("sandbox-build", (message) => {
      if (!live) return;
      if (message.payload.state === "building") {
        if (hideTimer.current) window.clearTimeout(hideTimer.current);
        setEvent(message.payload);
        return;
      }
      setEvent(message.payload);
      if (message.payload.state !== "failed") scheduleHide();
    }).then((stop) => {
      if (live) unlisten = stop;
      else stop();
    });

    api
      .sandboxStatus()
      .then((status) => {
        if (
          live &&
          status.state === "building" &&
          status.detail
        ) {
          setEvent({ state: "building", detail: status.detail });
        }
      })
      .catch(() => undefined);

    return () => {
      live = false;
      unlisten?.();
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, []);

  if (!event) return null;
  const failed = event.state === "failed";
  const done = event.state === "ready";

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed bottom-4 right-4 z-[140] flex max-w-[360px] items-start gap-2 rounded-card border border-border bg-surface px-3 py-2 text-xs shadow-[var(--shadow)]"
    >
      <span className="mt-0.5 flex-none">
        {failed ? (
          <TriangleAlert size={14} className="text-danger" />
        ) : done ? (
          <Check size={14} className="text-success" />
        ) : (
          <Loader2 size={14} className="animate-spin text-accent" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium">
          {failed ? "Sandbox build failed" : done ? "Sandbox ready" : "Building sandbox"}
        </span>
        <span className="mt-0.5 block break-words text-muted">{errorText(event.detail)}</span>
      </span>
      {event.state !== "building" && (
        <Button
          size="sm"
          variant="ghost"
          aria-label="Dismiss sandbox status"
          onClick={() => setEvent(null)}
        >
          <X size={12} />
        </Button>
      )}
    </div>
  );
}
