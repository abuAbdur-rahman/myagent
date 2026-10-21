import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Mic, RefreshCw, TriangleAlert } from "lucide-react";
import * as api from "../../lib/api";
import type { VoiceFile, VoiceProgress, VoiceStatus } from "../../lib/api";
import { formatInvokeError } from "../../lib/api";
import { formatBytes } from "../../lib/chat-docs";
import { useApp } from "../../lib/store";
import { toast } from "../../lib/toast";
import { Badge, Button, Input, Spinner } from "../ui";
import { Select } from "../ui/select";

function needsModel(status: VoiceStatus | null): boolean {
  return status !== null && status.enabled && !status.ready && status.provider === null;
}

const TOGGLE_LABELS: Record<string, string> = {
  download: "Download model",
  on: "Disable",
  off: "Enable",
};

function busyLabel(busy: string | null): string | null {
  if (busy === "enable") return "Preparing…";
  if (busy === "disable") return "Disabling…";
  return null;
}

function idleLabel(download: boolean, enabled: boolean): string {
  if (download) return TOGGLE_LABELS.download;
  return enabled ? TOGGLE_LABELS.on : TOGGLE_LABELS.off;
}

function toggleLabel(busy: string | null, download: boolean, enabled: boolean): string {
  return busyLabel(busy) ?? idleLabel(download, enabled);
}

function toggleAction(
  status: VoiceStatus | null,
  download: boolean,
): { label: string; work: () => Promise<VoiceStatus> } {
  const disable = status !== null && status.enabled && !download;
  return disable
    ? { label: "disable", work: api.voiceDisable }
    : { label: "enable", work: api.voiceEnable };
}

function ProgressBar({ progress }: { progress: VoiceProgress }) {
  const percent = progress.total > 0
    ? Math.min(100, Math.round((progress.done / progress.total) * 100))
    : 0;
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between text-xs text-muted">
        <span className="truncate">{progress.file}</span>
        <span>{percent}%</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-active">
        <div className="h-full bg-accent" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function DownloadProgress({
  busy,
  progress,
}: {
  busy: string | null;
  progress: VoiceProgress | null;
}) {
  if (busy !== "enable" || progress === null || progress.file === "done") return null;
  return <ProgressBar progress={progress} />;
}

function FileList({ files }: { files: VoiceFile[] }) {
  return (
    <ul className="mt-2 space-y-1 text-xs">
      {files.map((file) => (
        <li key={file.name} className="flex items-center justify-between gap-3">
          <span className="truncate text-muted">{file.name}</span>
          <span className={file.bytes === file.expected ? "text-accent" : "text-warn"}>
            {file.bytes === file.expected ? "ready" : formatBytes(file.bytes)}
          </span>
        </li>
      ))}
    </ul>
  );
}

function LocalHeader({
  status,
  busy,
  download,
  onToggle,
}: {
  status: VoiceStatus;
  busy: string | null;
  download: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <div className="flex items-center gap-2 font-medium">
          <Mic size={15} />
          Push to talk
          <Badge>{status.enabled ? "On" : "Off"}</Badge>
        </div>
        <p className="mt-1 text-xs text-muted">
          Moonshine base, int8, {formatBytes(status.expected)} download. Runs on the CPU and unloads
          after five idle minutes.
        </p>
      </div>
      <Button
        size="sm"
        variant={status.enabled && !download ? "ghost" : "primary"}
        disabled={busy !== null}
        onClick={onToggle}
      >
        {toggleLabel(busy, download, status.enabled)}
      </Button>
    </div>
  );
}

function LocalCard({
  status,
  busy,
  progress,
  download,
  onToggle,
}: {
  status: VoiceStatus;
  busy: string | null;
  progress: VoiceProgress | null;
  download: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded-card border border-border bg-surface-2 p-3" data-setting-term="Microphone">
      <LocalHeader status={status} busy={busy} download={download} onToggle={onToggle} />
      <DownloadProgress busy={busy} progress={progress} />
      <div className="mt-3 flex items-center justify-between text-xs text-muted">
        <span className="truncate" title={status.model_dir}>
          {status.model_dir}
        </span>
        <span className="flex-none">
          {formatBytes(status.bytes)} / {formatBytes(status.expected)}
        </span>
      </div>
      <FileList files={status.files} />
      {download && (
        <div className="mt-3 flex items-center gap-2 text-xs text-warn">
          <TriangleAlert size={13} />
          Model files are missing. Download them to finish setup.
        </div>
      )}
    </div>
  );
}

function ProviderSelect({
  remote,
  options,
  onRemote,
}: {
  remote: string;
  options: { value: string; label: string }[];
  onRemote: (value: string) => void;
}) {
  return (
    <Select
      size="sm"
      value={remote || "local"}
      onChange={(value) => onRemote(value === "local" ? "" : value)}
      options={[{ value: "local", label: "Local (Moonshine)" }, ...options]}
      aria-label="Transcription provider"
    />
  );
}

function SaveButton({ busy, onSave }: { busy: string | null; onSave: () => void }) {
  return (
    <Button size="sm" variant="ghost" disabled={busy !== null} onClick={onSave}>
      {busy === "provider" ? <RefreshCw size={13} className="animate-spin" /> : "Save"}
    </Button>
  );
}

function ProviderCard({
  connections,
  remote,
  remoteModel,
  busy,
  onRemote,
  onModel,
  onSave,
}: {
  connections: { id: string; name: string; kind: string }[];
  remote: string;
  remoteModel: string;
  busy: string | null;
  onRemote: (value: string) => void;
  onModel: (value: string) => void;
  onSave: () => void;
}) {
  const options = connections
    .filter((connection) => connection.kind !== "openrouter")
    .map((connection) => ({ value: connection.id, label: connection.name }));
  const empty = remote !== "" && options.length === 0;
  return (
    <div className="rounded-card border border-border bg-surface-2 p-3" data-setting-term="Transcription provider">
      <div className="font-medium">Transcription provider</div>
      <p className="mt-1 text-xs text-muted">
        Local is the default and needs no key. Remote uses an OpenAI-compatible
        <code className="mx-1">/audio/transcriptions</code> endpoint with the connection's stored
        key.
      </p>
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <div className="sm:flex-1">
          <ProviderSelect remote={remote} options={options} onRemote={onRemote} />
        </div>
        <div className="sm:flex-1">
          <Input
            value={remoteModel}
            onChange={(event) => onModel(event.target.value)}
            placeholder="whisper-1"
            disabled={!remote}
            aria-label="Transcription model"
          />
        </div>
        <SaveButton busy={busy} onSave={onSave} />
      </div>
      {empty && (
        <p className="mt-2 text-xs text-warn">
          No custom connection is configured. Add one under Providers first.
        </p>
      )}
    </div>
  );
}

export function VoicePage() {
  const { connections } = useApp();
  const [status, setStatus] = useState<VoiceStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<VoiceProgress | null>(null);
  const [remote, setRemote] = useState("");
  const [remoteModel, setRemoteModel] = useState("whisper-1");
  const [error, setError] = useState<string | null>(null);

  const apply = (next: VoiceStatus, hydrate = false) => {
    setStatus(next);
    if (hydrate) {
      setRemote(next.provider ?? "");
      setRemoteModel(next.model ?? "whisper-1");
    }
  };

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void api
      .voiceStatus()
      .then((next) => {
        if (!disposed) apply(next, true);
      })
      .catch((cause) => {
        if (!disposed) setError(formatInvokeError(cause));
      });
    void listen<VoiceProgress>("voice_progress", (event) => {
      if (!disposed) setProgress(event.payload);
    })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch((cause) => {
        if (!disposed) setError(formatInvokeError(cause));
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const run = async (label: string, work: () => Promise<VoiceStatus>, hydrate = false) => {
    setBusy(label);
    setError(null);
    try {
      apply(await work(), hydrate);
    } catch (cause) {
      const message = formatInvokeError(cause);
      setError(message);
      toast(message);
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const download = needsModel(status);

  const toggle = () => {
    const action = toggleAction(status, download);
    void run(action.label, action.work);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-medium">Voice</h2>
        <p className="mt-1 text-sm text-muted">
          Hold the microphone button in the composer to dictate. Audio stays on this machine with
          the local model; nothing is uploaded unless you pick a remote provider.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-card border border-danger/40 bg-danger/10 p-3 text-sm">
          <TriangleAlert size={15} className="mt-0.5 flex-none text-danger" />
          <span>{error}</span>
        </div>
      )}

      {status === null ? (
        error ? null : <Spinner label="Loading voice settings" />
      ) : (
        <>
          <LocalCard
            status={status}
            busy={busy}
            progress={progress}
            download={download}
            onToggle={toggle}
          />
          <ProviderCard
            connections={connections}
            remote={remote}
            remoteModel={remoteModel}
            busy={busy}
            onRemote={setRemote}
            onModel={setRemoteModel}
            onSave={() =>
              void run(
                "provider",
                () => api.voiceSetProvider(remote || null, remote ? remoteModel : null),
                true,
              )
            }
          />
        </>
      )}
    </div>
  );
}

