import { useEffect, useState } from "react";
import { FolderOpen, Gauge, RefreshCw, Shield, TriangleAlert } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath, openUrl } from "@tauri-apps/plugin-opener";
import * as api from "../../lib/api";
import type { SandboxStatus } from "../../lib/api";
import { toast } from "../../lib/toast";
import { errorText } from "../../lib/utils";
import { blockedReason, imageSizeLabel, parsePackages, toggleAllowed } from "../../lib/sandbox";
import { Badge, Button, Input, Spinner, Toggle } from "../ui";

const EXTRAS = [
  { name: "python3-numpy", label: "numpy" },
  { name: "python3-pandas", label: "pandas" },
  { name: "node-typescript", label: "TypeScript" },
  { name: "jq", label: "jq" },
];

const PROFILES = [
  { id: "core", label: "Core", detail: "PDF, OCR, fonts", size: "~1 GB" },
  { id: "office", label: "Office", detail: "LibreOffice + deck tools", size: "~2.1 GB" },
  { id: "full", label: "Full", detail: "CJK fonts, more OCR", size: "~2.5 GB" },
] as const;

const STATUS_LABEL: Record<SandboxStatus["state"], string> = {
  not_installed: "Docker missing",
  daemon_stopped: "Docker stopped",
  no_image: "Not built",
  building: "Building",
  ready: "Ready",
};

function useSandbox() {
  const [status, setStatus] = useState<SandboxStatus | null>(null);
  const [root, setRoot] = useState("");
  const [extras, setExtras] = useState<string[]>([]);
  const [advanced, setAdvanced] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [cpus, setCpus] = useState("1");
  const [memory, setMemory] = useState("1024");
  const [profile, setProfile] = useState<SandboxStatus["profile"]>("office");

  const apply = (next: SandboxStatus) => {
    const known = new Set(EXTRAS.map((extra) => extra.name));
    setStatus(next);
    setRoot(next.project_root ?? "");
    setExtras(next.packages.filter((name) => known.has(name)));
    setAdvanced(next.packages.filter((name) => !known.has(name)).join(" "));
    setCpus(String(next.cpus));
    setMemory(String(next.memory_mb));
    setProfile(next.profile);
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

  useEffect(() => {
    if (status?.state !== "building") return;
    const timer = window.setInterval(() => void load(), 2500);
    return () => window.clearInterval(timer);
  }, [status?.state]);

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
    void run("enable", () =>
      api.sandboxEnable(profile, parsePackages(extras, advanced), root || null),
    );

  const pickFolder = async () => {
    try {
      const picked = await open({ directory: true, multiple: false });
      if (typeof picked === "string") setRoot(picked);
    } catch (error) {
      toast(errorText(error));
    }
  };

  return {
    status,
    root,
    extras,
    advanced,
    busy,
    cpus,
    memory,
    profile,
    setProfile,
    setAdvanced,
    setCpus,
    setMemory,
    setExtras,
    load,
    enable,
    pickFolder,
    run,
  };
}

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
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
      <Badge
        className={
          status.state === "ready"
            ? "text-success"
            : status.state === "building"
              ? "text-accent"
              : "text-warn"
        }
      >
        {STATUS_LABEL[status.state]}
      </Badge>
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

function DockerHelp({
  status,
  onRecheck,
}: {
  status: SandboxStatus;
  onRecheck: () => void;
}) {
  if (status.state === "not_installed") {
    return (
      <div className="rounded-card border border-border bg-surface-2 p-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <TriangleAlert size={15} className="text-warn" /> Install Docker Desktop
        </div>
        <p className="mt-1 text-xs text-muted">
          The sandbox runs in Docker. Install it, start it once, then recheck.
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
      <div className="rounded-card border border-border bg-surface-2 p-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <TriangleAlert size={15} className="text-warn" /> Start Docker Desktop
        </div>
        <p className="mt-1 text-xs text-muted">
          Docker is installed but not running. Start it and wait for the whale to settle.
        </p>
        <div className="mt-2 flex gap-2">
          <Button
            size="sm"
            onClick={() =>
              void openPath("C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe").catch(
                (error) => toast(errorText(error)),
              )
            }
          >
            Start Docker
          </Button>
          <Button size="sm" variant="ghost" onClick={onRecheck}>
            Recheck
          </Button>
        </div>
      </div>
    );
  }
  return null;
}

function Setup({
  sandbox,
}: {
  sandbox: ReturnType<typeof useSandbox>;
}) {
  const { status, root, busy, profile } = sandbox;
  if (!status) return null;
  return (
    <>
      <div className="flex flex-col gap-2" data-setting-term="Project folder">
        <div className="text-xs font-medium">Project folder</div>
        <div className="flex gap-2">
          <Input value={root} readOnly placeholder="Choose the folder the sandbox can see" aria-label="Project folder" />
          <Button size="sm" onClick={() => void sandbox.pickFolder()} disabled={status.enabled || busy !== null}>
            <FolderOpen size={13} /> Choose
          </Button>
        </div>
      </div>

      <div className="flex flex-col gap-2" data-setting-term="Toolchain profile">
        <div className="text-xs font-medium">Toolchain</div>
        <div className="grid grid-cols-3 gap-2">
          {PROFILES.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={profile === item.id}
              onClick={() => sandbox.setProfile(item.id)}
              className={
                profile === item.id
                  ? "rounded-card border border-accent bg-active p-2 text-left text-xs"
                  : "rounded-card border border-border p-2 text-left text-xs hover:bg-hover"
              }
            >
              <span className="block font-medium">{item.label}</span>
              <span className="block text-muted">{item.detail}</span>
              <span className="mt-0.5 block text-[11px] text-muted">{item.size}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <p className="m-0 text-xs text-muted">
          Builds once. Downloads in the background; you can keep chatting.
        </p>
        <Button
          variant="primary"
          size="sm"
          disabled={!root || busy !== null}
          onClick={sandbox.enable}
        >
          {status.state === "building" || busy === "enable" ? (
            <Spinner label="Building" />
          ) : status.enabled ? (
            "Rebuild image"
          ) : (
            "Enable sandbox"
          )}
        </Button>
      </div>
    </>
  );
}

function Advanced({ sandbox }: { sandbox: ReturnType<typeof useSandbox> }) {
  const { status, extras, advanced, cpus, memory, busy } = sandbox;
  if (!status) return null;
  const toggleExtra = (name: string) =>
    sandbox.setExtras((current) =>
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name],
    );
  return (
    <details className="rounded-card border border-border" data-setting-term="Packages">
      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-muted">
        Packages and limits
      </summary>
      <div className="flex flex-col gap-3 border-t border-border p-3">
        <div className="grid grid-cols-2 gap-1 text-xs">
          {EXTRAS.map((extra) => (
            <label key={extra.name} className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={extras.includes(extra.name)}
                onChange={() => toggleExtra(extra.name)}
                aria-label={extra.label}
              />
              {extra.label}
            </label>
          ))}
        </div>
        <Input
          value={advanced}
          onChange={(event) => sandbox.setAdvanced(event.target.value)}
          placeholder="More apt packages, space separated"
          aria-label="Advanced packages"
        />
        <div className="flex flex-wrap items-end gap-2 text-xs" data-setting-term="Limits">
          <label className="flex items-center gap-1">
            CPU
            <Input className="w-16" value={cpus} onChange={(event) => sandbox.setCpus(event.target.value)} aria-label="CPU limit" />
          </label>
          <label className="flex items-center gap-1">
            Memory MB
            <Input className="w-20" value={memory} onChange={(event) => sandbox.setMemory(event.target.value)} aria-label="Memory limit" />
          </label>
          <Button
            size="sm"
            disabled={busy !== null}
            onClick={() =>
              void sandbox.run("limits", () =>
                api.sandboxSetLimits(Number(cpus), Math.round(Number(memory))),
              )
            }
          >
            Save limits
          </Button>
        </div>
      </div>
    </details>
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

  const reason = blockedReason(status, sandbox.root);
  const setup = status.state !== "ready";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4" data-setting-term="Enable sandbox">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium">
            <Shield size={16} /> Sandbox
            <Badge
              className={
                status.state === "ready"
                  ? "text-success"
                  : status.state === "building"
                    ? "text-accent"
                    : "text-warn"
              }
            >
              {STATUS_LABEL[status.state]}
            </Badge>
          </div>
          <p className="mt-1 max-w-xl text-xs text-muted">
            Commands run in Docker with no internet and only this project folder. Your host shell
            stays read-only.
          </p>
        </div>
        <Toggle
          checked={status.enabled}
          disabled={busy !== null || !toggleAllowed(status, sandbox.root)}
          label="Enable sandbox"
          onChange={(value) =>
            value
              ? sandbox.enable()
              : void sandbox.run("disable", () => api.sandboxDisable())
          }
        />
      </div>

      <StatusLine status={status} busy={busy} onRecheck={() => void sandbox.load()} />

      <DockerHelp status={status} onRecheck={() => void sandbox.load()} />
      {reason && status.state !== "daemon_stopped" && (
        <p className="m-0 text-xs text-muted">{reason}</p>
      )}

      {status.state === "building" && (
        <div className="flex items-center gap-2 rounded-card border border-border bg-surface-2 p-3 text-xs text-muted" role="status">
          <Spinner /> {status.detail || "Building the sandbox image…"}
        </div>
      )}

      {setup ? (
        <Setup sandbox={sandbox} />
      ) : (
        <>
          <div className="rounded-card border border-border p-3" data-setting-term="Project folder">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-medium">Project folder</span>
              <span className="truncate font-mono text-[11px] text-muted" title={sandbox.root}>
                {sandbox.root || "Not set"}
              </span>
            </div>
          </div>

          <div className="rounded-card border border-border p-3">
            <div className="flex items-center justify-between gap-2 text-xs">
              <span className="font-medium">Toolchain</span>
              <span className="text-muted">
                {status.profile} · {imageSizeLabel(status.image_size) || "image ready"}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted">
              Python, Node, PDF/OCR, LibreOffice and deck tools are ready. Rebuild after changing
              packages.
            </p>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy !== null}
                onClick={() => void sandbox.run("rebuild", () => api.sandboxRebuild())}
              >
                <RefreshCw size={12} /> Rebuild image
              </Button>
            </div>
          </div>

          <div className="flex items-start justify-between gap-4 rounded-card border border-border p-3" data-setting-term="Allow installs">
            <div>
              <div className="text-xs font-medium">Allow installs</div>
              <p className="mt-1 max-w-xl text-xs text-muted">
                Off by default. A skill cannot change its own toolchain; pip, npm and apt are refused.
              </p>
            </div>
            <Toggle
              checked={status.allow_installs}
              disabled={busy !== null}
              label="Allow installs"
              onChange={(allow) =>
                void sandbox.run("installs", () => api.sandboxSetAllowInstalls(allow))
              }
            />
          </div>
        </>
      )}

      <Advanced sandbox={sandbox} />

      <p className="m-0 flex items-center gap-1.5 text-[11px] text-muted">
        <Gauge size={12} /> Changes outside git cannot be undone. Unlimited installs are still
        blocked by the container.
      </p>
    </div>
  );
}
