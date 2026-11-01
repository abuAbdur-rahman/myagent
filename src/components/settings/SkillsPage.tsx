import { useEffect, useState } from "react";
import { FolderOpen, Play, Sparkles } from "lucide-react";
import { openPath } from "@tauri-apps/plugin-opener";
import * as api from "../../lib/api";
import type { SkillDoctorResult, SkillInfo } from "../../lib/api";
import { toast } from "../../lib/toast";
import { errorText } from "../../lib/utils";
import { Badge, Button, Spinner, Toggle } from "../ui";

function Requirement({ skill }: { skill: SkillInfo }) {
  const tools = [...skill.requires_tools];
  const imports = [
    ...skill.requires_python.map((name) => `python:${name}`),
    ...skill.requires_node.map((name) => `node:${name}`),
  ];
  if (tools.length === 0 && imports.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px] text-muted">
      <span>Needs</span>
      {tools.map((tool) => (
        <Badge key={tool}>{tool}</Badge>
      ))}
      {imports.map((name) => (
        <Badge key={name}>{name}</Badge>
      ))}
    </div>
  );
}

function DoctorNote({ result }: { result: SkillDoctorResult }) {
  return (
    <div className="mt-2 rounded-card border border-border bg-surface-2 p-2 text-xs" role="status">
      <div className="flex items-center gap-2">
        <Badge className={result.ok ? "text-success" : "text-warn"}>
          {result.ok ? "Self-test passed" : "Self-test failed"}
        </Badge>
        {Object.entries(result.versions).map(([tool, version]) => (
          <span key={tool} className="text-muted">
            {tool} {version}
          </span>
        ))}
      </div>
      {result.detail && (
        <p className="mt-1 whitespace-pre-wrap text-muted">{result.detail}</p>
      )}
      {result.missing.length > 0 && (
        <p className="mt-1 text-muted">Missing: {result.missing.join(", ")}</p>
      )}
      {result.failed_tests.length > 0 && (
        <p className="mt-1 text-muted">Failed tests: {result.failed_tests.join(", ")}</p>
      )}
    </div>
  );
}

function SkillCard({ skill, onChange }: { skill: SkillInfo; onChange: (next: SkillInfo[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [doctor, setDoctor] = useState<SkillDoctorResult | null>(null);

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    try {
      onChange(await api.skillsSetEnabled(skill.id, enabled));
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const runDoctor = async () => {
    setBusy(true);
    try {
      setDoctor(await api.skillsDoctor(skill.id));
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-card border border-border p-3" data-setting-term={skill.title}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Sparkles size={14} className="text-muted" />
            <span className="truncate">{skill.title}</span>
            <Badge>{skill.version}</Badge>
            <Badge>{skill.source}</Badge>
          </div>
          <p className="mt-1 text-xs text-muted">{skill.summary}</p>
          <Requirement skill={skill} />
        </div>
        <Toggle
          checked={skill.enabled}
          disabled={busy}
          label={`Enable ${skill.title}`}
          onChange={(value) => void toggle(value)}
        />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <Button size="sm" disabled={busy} onClick={() => void runDoctor()}>
          {busy ? <Spinner label="Running" /> : <><Play size={12} /> Run self-test</>}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() =>
            void Promise.resolve(openPath(skill.directory)).catch((error) =>
              toast(errorText(error)),
            )
          }
        >
          <FolderOpen size={12} /> Open folder
        </Button>
      </div>
      {doctor && <DoctorNote result={doctor} />}
    </div>
  );
}

export function SkillsPage() {
  const [skills, setSkills] = useState<SkillInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .skillsList()
      .then((next) => {
        if (live) setSkills(next);
      })
      .catch((reason) => {
        if (live) setError(errorText(reason));
      });
    return () => {
      live = false;
    };
  }, []);

  if (error) {
    return <p className="text-sm text-muted">{error}</p>;
  }
  if (!skills) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted">
        <Spinner /> Loading skills…
      </div>
    );
  }
  if (skills.length === 0) {
    return (
      <p className="text-sm text-muted">
        No skills installed yet. The PDF and deck skills arrive in 0.9.0; user skills live in
        the app data skills folder.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted">
        Skills load instructions on demand. Their scripts run inside the sandbox and follow the
        same approvals as any other command.
      </p>
      {skills.map((skill) => (
        <SkillCard key={skill.id} skill={skill} onChange={setSkills} />
      ))}
    </div>
  );
}
