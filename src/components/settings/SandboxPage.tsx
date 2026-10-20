import { useEffect, useState } from "react";
import { FolderOpen, RefreshCw, Shield, TriangleAlert } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import * as api from "../../lib/api";
import type { SandboxStatus } from "../../lib/api";
import { toast } from "../../lib/toast";
import { errorText } from "../../lib/utils";
import {
  blockedReason,
  imageSizeLabel,
  parsePackages,
  toggleAllowed,
} from "../../lib/sandbox";
import { Badge, Button, Input, Spinner, Toggle } from "../ui";

const EXTRAS = [
  { name: "python3-numpy", label: "numpy", size: "~35 MB" },
  { name: "python3-pandas", label: "pandas", size: "~60 MB" },
  { name: "node-typescript", label: "TypeScript", size: "~8 MB" },
  { name: "jq", label: "jq", size: "~1 MB" },
];

function useSandbox() {
  const [status, setStatus] = useState<SandboxStatus | null>(null);
  const [root, setRoot] = useState("");
  const [extras, setExtras] = useState<string[]>([]);
  const [advanced, setAdvanced] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [cpus, setCpus] = useState("1");
  const [memory, setMemory] = useState("1024");

  const apply = (next: SandboxStatus) => {
    const known = new Set(EXTRAS.map((extra) => extra.name));
    setStatus(next);
    setRoot(next.project_root ?? "");
    setExtras(next.packages.filter((name) => known.has(name)));
    setAdvanced(next.packages.filter((name) => !known.has(name)).join(" "));
    setCpus(String(next.cpus));
    setMemory(String(next.memory_mb));
  };

  const load = async () => {
    try {
      apply(await api.sandboxStatus());
    } catch (error) {
      toast(errorText(error));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const run = async (label: string, work: () => Promise<SandboxStatus>) => {
    setBusy(label);
    try {
      apply(await work());
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(null);
    }
  };

  const enable = () =>
    void run("enable", () => api.sandboxEnable(parsePackages(extras, advanced), root || null));

  const pickFolder = async () => {
    try {
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked === "string") setRoot(picked);
    } catch (error) {
      toast(errorText(error));
    }
  };

  const toggleExtra = (name: string) => {
    setExtras((current) =>
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name],
    );
  };

  return {
    status,
    root,
    extras,
    advanced,
    busy,
    cpus,
    memory,
    setAdvanced,
    setCpus,
    setMemory,
    load,
    enable,
    pickFolder,
    toggleExtra,
    run,
  };
}

function StateNote({ status }: { status: SandboxStatus }) {
  if (status.state === "not_installed") {
    return (
      <div className="rounded-card border border-border bg-surface-2 p-3 text-sm">
        <div className="flex items-center gap-2 font-medium">
          <TriangleAlert size={15} className="text-warn" />
          Docker Desktop is required
        </div>
        <p className="mt-1 text-xs text-muted">
          The sandbox runs commands in Docker with no internet and only this project folder
          visible. Install Docker Desktop, start it once, then recheck.
        </p>
        <Button
          className="mt-2"
          size="sm"
          onClick={() =>
            void openUrl("https://www.docker.com/products/docker-desktop/").catch((error) =>
              toast(errorText(error)),
            )
          }
        >
          Download Docker Desktop
        </Button>
      </div>
    );
  }
  if (status.state === "daemon_stopped") {
    return (
      <div className="rounded-card border border-border bg-surface-2 p-3 text-sm">
        <div className="flex items-center gap-2 font-medium">
          <TriangleAlert size={15} className="text-warn" />
          Docker is installed but stopped
        </div>
        <p className="mt-1 text-xs text-muted">
          Start Docker Desktop, wait for the whale to stop animating, then recheck. The sandbox
          never falls back to running code on the host.
        </p>
      </div>
    );
  }
  return null;
}

function Header({
  status,
  root,
  busy,
  onEnable,
  onDisable,
}: {
  status: SandboxStatus;
  root: string;
  busy: string | null;
  onEnable: () => void;
  onDisable: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border pb-3">
      <div>
        <div className="flex items-center gap-2 text-sm font-medium">
          <Shield size={16} /> Run code in a sandbox
        </div>
        <p className="mt-1 max-w-xl text-xs text-muted">
          Off by default. Commands run in Docker with no internet, no access outside this
          project folder, and a checkpoint before each run. The host shell stays inspection-only
          while this is on.
        </p>
      </div>
      <Toggle
        checked={status.enabled}
        disabled={busy !== null || !toggleAllowed(status, root)}
        label="Enable sandbox"
        onChange={(value) => (value ? onEnable() : onDisable())}
      />
    </div>
  );
}

function FolderSection({
  status,
  root,
  busy,
  onPick,
}: {
  status: SandboxStatus;
  root: string;
  busy: string | null;
  onPick: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs font-medium">Project folder</div>
      <div className="flex gap-2">
        <Input
          value={root}
          readOnly
          placeholder="No folder selected"
          aria-label="Project folder"
        />
        <Button size="sm" onClick={onPick} disabled={status.enabled || busy !== null}>
          <FolderOpen size={13} /> Choose
        </Button>
      </div>
      <p className="text-xs text-muted">
        Only this folder is mounted into the container. Changes outside a git repository cannot
        be undone.
      </p>
    </div>
  );
}

function PackagesSection({
  root,
  extras,
  advanced,
  busy,
  onToggleExtra,
  onAdvanced,
  onEnable,
}: {
  root: string;
  extras: string[];
  advanced: string;
  busy: string | null;
  onToggleExtra: (name: string) => void;
  onAdvanced: (value: string) => void;
  onEnable: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-card border border-border p-3">
      <div className="text-xs font-medium">Packages</div>
      <div className="grid grid-cols-2 gap-1 text-xs">
        {EXTRAS.map((extra) => (
          <label key={extra.name} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={extras.includes(extra.name)}
              onChange={() => onToggleExtra(extra.name)}
              aria-label={extra.label}
            />
            {extra.label} <span className="text-muted">{extra.size}</span>
          </label>
        ))}
      </div>
      <Input
        value={advanced}
        onChange={(event) => onAdvanced(event.target.value)}
        placeholder="More apt packages, space separated"
        aria-label="Advanced packages"
      />
      <div className="flex items-center justify-between text-xs text-muted">
        <span>Baseline: python3, Node, ripgrep, coreutils. About 250 MB to download once.</span>
        <Button variant="primary" size="sm" disabled={!root || busy !== null} onClick={onEnable}>
          {busy === "enable" ? <Spinner label="Building" /> : "Enable sandbox"}
        </Button>
      </div>
    </div>
  );
}

function LimitsSection({
  cpus,
  memory,
  busy,
  onCpus,
  onMemory,
  onSave,
  onRebuild,
}: {
  cpus: string;
  memory: string;
  busy: string | null;
  onCpus: (value: string) => void;
  onMemory: (value: string) => void;
  onSave: () => void;
  onRebuild: () => void;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-card border border-border p-3">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium">Limits</span>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1">
            CPU
            <Input
              className="w-16"
              value={cpus}
              onChange={(event) => onCpus(event.target.value)}
              aria-label="CPU limit"
            />
          </label>
          <label className="flex items-center gap-1">
            Memory MB
            <Input
              className="w-20"
              value={memory}
              onChange={(event) => onMemory(event.target.value)}
              aria-label="Memory limit"
            />
          </label>
          <Button size="sm" disabled={busy !== null} onClick={onSave}>
            Save
          </Button>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted">
          Docker Desktop uses about 3 GB idle on this machine; limits apply per command.
        </span>
        <Button size="sm" disabled={busy !== null} onClick={onRebuild}>
          {busy === "rebuild" ? <Spinner label="Rebuilding" /> : "Rebuild image"}
        </Button>
      </div>
    </div>
  );
}

type SandboxModel = ReturnType<typeof useSandbox>;

function StatusLine({
  status,
  busy,
  onRecheck,
}: {
  status: SandboxStatus;
  busy: string | null;
  onRecheck: () => void;
}) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted">
      <Badge>{status.state.replace("_", " ")}</Badge>
      {status.docker && <span>Docker {status.docker}</span>}
      {status.image_size ? <span>{imageSizeLabel(status.image_size)}</span> : null}
      <Button
        size="sm"
        variant="ghost"
        disabled={busy !== null}
        onClick={onRecheck}
        aria-label="Recheck Docker"
      >
        <RefreshCw size={13} /> Recheck
      </Button>
    </div>
  );
}

function Reason({ status, root }: { status: SandboxStatus; root: string }) {
  const reason = blockedReason(status, root);
  return reason ? <p className="text-xs text-muted">{reason}</p> : null;
}

function PackagesPanel({ sandbox }: { sandbox: SandboxModel }) {
  const { status, root, extras, advanced, busy } = sandbox;
  if (status?.state !== "no_image") return null;
  return (
    <PackagesSection
      root={root}
      extras={extras}
      advanced={advanced}
      busy={busy}
      onToggleExtra={sandbox.toggleExtra}
      onAdvanced={sandbox.setAdvanced}
      onEnable={sandbox.enable}
    />
  );
}

function LimitsPanel({ sandbox }: { sandbox: SandboxModel }) {
  const { status, cpus, memory, busy } = sandbox;
  if (status?.state !== "ready") return null;
  return (
    <LimitsSection
      cpus={cpus}
      memory={memory}
      busy={busy}
      onCpus={sandbox.setCpus}
      onMemory={sandbox.setMemory}
      onSave={() =>
        void sandbox.run("limits", () =>
          api.sandboxSetLimits(Number(cpus), Math.round(Number(memory))),
        )
      }
      onRebuild={() => void sandbox.run("rebuild", () => api.sandboxRebuild())}
    />
  );
}

function BusyLine({ busy }: { busy: string | null }) {
  if (!busy) return null;
  return (
    <div className="flex items-center gap-2 text-xs text-muted" role="status">
      <Spinner /> {busy === "enable" ? "Pulling and building the image…" : `${busy}…`}
    </div>
  );
}

export function SandboxPage() {
  const sandbox = useSandbox();
  const { status, busy } = sandbox;

  if (!status) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted">
        <Spinner /> Checking Docker…
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Header
        status={status}
        root={sandbox.root}
        busy={busy}
        onEnable={sandbox.enable}
        onDisable={() => void sandbox.run("disable", () => api.sandboxDisable())}
      />
      <StateNote status={status} />
      <Reason status={status} root={sandbox.root} />
      <StatusLine status={status} busy={busy} onRecheck={() => void sandbox.load()} />
      <FolderSection
        status={status}
        root={sandbox.root}
        busy={busy}
        onPick={() => void sandbox.pickFolder()}
      />
      <PackagesPanel sandbox={sandbox} />
      <LimitsPanel sandbox={sandbox} />
      <BusyLine busy={busy} />
    </div>
  );
}
