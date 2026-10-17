import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Button, Pill, Spinner, type PillTone } from "../ui";
import { cn } from "../../lib/utils";
import { useAppUpdate, type AppUpdate } from "./useAppUpdate";
import {
  CHANGE_KINDS,
  CHANGE_LABELS,
  RELEASES,
  changeCountLabel,
  filterReleases,
  type ChangeKind,
  type Release,
  type ReleaseChange,
} from "../../lib/releasenotes";

const KIND_TONE: Record<ChangeKind, PillTone> = {
  new: "accent",
  improved: "neutral",
  fixed: "success",
};

const NEWEST = RELEASES[0]?.version ?? null;

function InstallButton({ app }: { app: AppUpdate }) {
  const busy = app.progress !== null;
  return (
    <Button variant="primary" size="sm" disabled={busy} onClick={() => void app.install()}>
      {busy ? `Installing… ${app.progress ?? 0}%` : "Download & install"}
    </Button>
  );
}

function CheckButton({ app }: { app: AppUpdate }) {
  return (
    <Button variant="default" size="sm" disabled={app.checking} onClick={() => void app.checkNow()}>
      {app.checking ? <Spinner label="Checking…" /> : "Check for updates"}
    </Button>
  );
}

function VersionActions({ app }: { app: AppUpdate }) {
  return app.update ? <InstallButton app={app} /> : <CheckButton app={app} />;
}

function UpdateProgress({ app }: { app: AppUpdate }) {
  if (!app.update || app.progress === null) return null;
  return (
    <div className="mt-2 h-1 w-full overflow-hidden rounded bg-active">
      <div className="h-full bg-accent" style={{ width: `${app.progress}%` }} />
    </div>
  );
}

function UpdateStatus({ app }: { app: AppUpdate }) {
  return (
    <>
      {app.update && (
        <p className="mt-2 text-xs text-text" role="status">
          Version {app.update.version} is ready.
        </p>
      )}
      {app.status && (
        <p className="mt-2 text-xs text-muted" role="status">
          {app.status}
        </p>
      )}
    </>
  );
}

function VersionCard({ app }: { app: AppUpdate }) {
  return (
    <div className="rounded-card border border-border bg-surface px-3 py-3">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-medium tabular-nums">MyAgent {app.version}</h3>
            <Pill tone="success">Installed</Pill>
          </div>
          <p className="text-xs text-muted">Signed releases from GitHub</p>
        </div>
        <div className="flex-none">
          <VersionActions app={app} />
        </div>
      </div>
      <UpdateProgress app={app} />
      <UpdateStatus app={app} />
    </div>
  );
}

function KindFilter({
  kinds,
  onToggle,
}: {
  kinds: ChangeKind[];
  onToggle: (kind: ChangeKind) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 px-2" role="group" aria-label="Filter by change type">
      {CHANGE_KINDS.map((kind) => {
        const active = kinds.includes(kind);
        return (
          <button
            key={kind}
            type="button"
            aria-pressed={active}
            onClick={() => onToggle(kind)}
            className={cn(
              "h-6 rounded-full border px-2 text-[11px] font-medium",
              active ? "border-accent text-accent" : "border-border text-muted hover:bg-hover",
            )}
          >
            {CHANGE_LABELS[kind]}
          </button>
        );
      })}
    </div>
  );
}

function ChangeRow({ change }: { change: ReleaseChange }) {
  return (
    <li className="flex items-start gap-2 px-2 py-1">
      <Pill tone={KIND_TONE[change.kind]} className="mt-0.5">
        {CHANGE_LABELS[change.kind]}
      </Pill>
      <span className="min-w-0 text-xs">{change.text}</span>
    </li>
  );
}

function chevronClass(open: boolean): string {
  return cn("flex-none text-muted transition-transform", !open && "-rotate-90");
}

function ReleaseCard({
  release,
  installed,
  open,
  onToggle,
}: {
  release: Release;
  installed: boolean;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded-card border border-border bg-surface">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex w-full items-center gap-2 rounded-card px-3 py-2.5 text-left hover:bg-hover"
      >
        <ChevronDown size={14} className={chevronClass(open)} />
        <span className="flex-none text-sm font-medium tabular-nums">{release.version}</span>
        {installed && <Pill tone="success">Current</Pill>}
        <span className="min-w-0 flex-1" />
        <span className="flex-none text-[11px] tabular-nums text-muted">{release.date}</span>
        <span className="flex-none text-[11px] tabular-nums text-muted">
          {changeCountLabel(release)}
        </span>
      </button>
      {open && (
        <div className="border-t border-border py-1">
          <p className="px-2 py-1.5 text-xs text-muted">{release.summary}</p>
          <ul>
            {release.changes.map((change) => (
              <ChangeRow key={change.text} change={change} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function ChangelogPage() {
  const app = useAppUpdate();
  const [kinds, setKinds] = useState<ChangeKind[]>([]);
  const [open, setOpen] = useState<string | null>(NEWEST);
  const shown = useMemo(() => filterReleases(RELEASES, kinds), [kinds]);

  const toggleKind = (kind: ChangeKind) =>
    setKinds((prev) =>
      prev.includes(kind) ? prev.filter((item) => item !== kind) : [...prev, kind],
    );

  return (
    <div className="flex flex-col gap-3 pb-4">
      <VersionCard app={app} />
      <KindFilter kinds={kinds} onToggle={toggleKind} />
      {shown.length === 0 ? (
        <p className="px-2 py-6 text-center text-xs text-muted" role="status">
          No releases match that filter.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {shown.map((release) => (
            <ReleaseCard
              key={release.version}
              release={release}
              installed={release.version === app.version}
              open={open === release.version}
              onToggle={() => setOpen(open === release.version ? null : release.version)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
