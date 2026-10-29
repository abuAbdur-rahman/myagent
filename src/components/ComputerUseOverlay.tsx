import { useEffect, useState } from "react";
import { Pause, Play, X } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import * as api from "../lib/api";
import { cn } from "../lib/utils";

export function ComputerUseOverlay() {
  const [config, setConfig] = useState<api.ComputerUseConfig | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api
      .computerUseConfig()
      .then(setConfig)
      .catch((error) => console.warn("computer-use: overlay config failed", error));
    let dispose: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const [unlistenConfig, unlistenPaused] = await Promise.all([
          listen<api.ComputerUseConfig>("computer-use-config", (event) => {
            setConfig(event.payload);
          }),
          listen<boolean>("computer-use-paused", (event) => {
            setConfig((current) => (current ? { ...current, paused: event.payload } : current));
          }),
        ]);
        if (cancelled) {
          unlistenConfig();
          unlistenPaused();
        } else {
          dispose = () => {
            unlistenConfig();
            unlistenPaused();
          };
        }
      } catch (error) {
        console.warn("computer-use: overlay events unavailable", error);
      }
    })();
    return () => {
      cancelled = true;
      dispose?.();
    };
  }, []);

  const save = async (patch: { paused?: boolean; overlay?: boolean }) => {
    if (!config || busy) return;
    setBusy(true);
    try {
      const next =
        patch.paused !== undefined
          ? await api.computerUseSetPaused(patch.paused)
          : await api.computerUseSetOverlay(patch.overlay ?? false);
      setConfig(next);
      if (!next.enabled || !next.overlay) {
        await getCurrentWindow().hide();
      }
    } catch (error) {
      console.warn("computer-use: overlay save failed", error);
    } finally {
      setBusy(false);
    }
  };

  if (!config) return null;

  return (
    <div
      data-tauri-drag-region
      className="flex h-screen w-screen items-center gap-2 border border-border bg-surface px-3 text-xs"
    >
      <span
        className={cn(
          "h-2 w-2 flex-none rounded-full",
          config.paused ? "bg-warn" : config.dry_run ? "bg-accent" : "bg-success",
        )}
      />
      <div className="min-w-0 flex-1" data-tauri-drag-region>
        <div className="truncate font-medium">Computer use</div>
        <div className="truncate text-muted">
          {config.paused ? "Paused" : config.dry_run ? "Dry run" : "On"}
        </div>
      </div>
      <button
        type="button"
        aria-label={config.paused ? "Resume computer use" : "Pause computer use"}
        title={config.paused ? "Resume computer use" : "Pause computer use"}
        disabled={busy}
        onClick={() => void save({ paused: !config.paused })}
        className="grid h-7 w-7 place-items-center rounded-control text-muted hover:bg-hover hover:text-text disabled:opacity-50"
      >
        {config.paused ? <Play size={14} /> : <Pause size={14} />}
      </button>
      <button
        type="button"
        aria-label="Hide computer-use overlay"
        title="Hide computer-use overlay"
        disabled={busy}
        onClick={() => void save({ overlay: false })}
        className="grid h-7 w-7 place-items-center rounded-control text-muted hover:bg-hover hover:text-text disabled:opacity-50"
      >
        <X size={14} />
      </button>
    </div>
  );
}
