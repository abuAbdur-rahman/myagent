import { useEffect, useRef, useState, type ReactNode } from "react";
import { FileText, FolderOpen, PencilLine, Play, Plus, Sparkles, Upload } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { openPath } from "@tauri-apps/plugin-opener";
import * as api from "../../lib/api";
import type { SkillDoctorResult, SkillDraft, SkillInfo } from "../../lib/api";
import { toast } from "../../lib/toast";
import { errorText } from "../../lib/utils";
import { Badge, Button, Input, Spinner, Textarea, Toggle } from "../ui";
import { useFocusTrap } from "../../lib/useFocusTrap";

const TEMPLATE = `---
id: my-skill
title: My Skill
version: 1.0.0
triggers: ["keyword", "another phrase"]
requires_tools: []
requires_imports:
  python: []
  node: []
network: none
writes: ["outputs/"]
summary: One line that appears in the skill list.
---

# My Skill

Explain when to use this skill, the commands it runs, and how to verify the result.
`;

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

function SkillDialog({
  title,
  subtitle,
  wide,
  onClose,
  children,
}: {
  title: string;
  subtitle?: string;
  wide?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useFocusTrap(panel, true, onClose);
  return (
    <div
      className="fixed inset-0 z-[130] grid place-items-center bg-black/50 p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={
          wide
            ? "flex h-[92vh] w-[min(1100px,96vw)] flex-col overflow-hidden rounded-composer border border-border bg-surface shadow-[var(--shadow)]"
            : "flex max-h-[88vh] w-[min(620px,94vw)] flex-col overflow-hidden rounded-composer border border-border bg-surface shadow-[var(--shadow)]"
        }
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div>
            <h3 className="text-base font-semibold">{title}</h3>
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close">
            Close
          </Button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

function AddMenu({
  busy,
  onImportFile,
  onImportFolder,
  onWrite,
  onForm,
  onClose,
}: {
  busy: boolean;
  onImportFile: () => void;
  onImportFolder: () => void;
  onWrite: () => void;
  onForm: () => void;
  onClose: () => void;
}) {
  const choices = [
    {
      icon: <Upload size={16} />,
      title: "Import SKILL.md",
      detail: "Pick a single skill file from this PC.",
      action: onImportFile,
    },
    {
      icon: <FolderOpen size={16} />,
      title: "Import folder",
      detail: "Copy a skill folder with scripts, references and tests.",
      action: onImportFolder,
    },
    {
      icon: <FileText size={16} />,
      title: "Write SKILL.md",
      detail: "Full-screen editor, prefilled with the real format.",
      action: onWrite,
    },
    {
      icon: <PencilLine size={16} />,
      title: "Build from fields",
      detail: "Fill id, title, description and requirements, then write the body.",
      action: onForm,
    },
  ];
  return (
    <SkillDialog title="Add a skill" subtitle="User skills live in the app data skills folder." onClose={onClose}>
      <div className="grid gap-2">
        {choices.map((choice) => (
          <button
            key={choice.title}
            type="button"
            disabled={busy}
            onClick={choice.action}
            className="flex items-start gap-3 rounded-card border border-border p-3 text-left hover:bg-hover disabled:opacity-50"
          >
            <span className="mt-0.5 text-muted">{choice.icon}</span>
            <span>
              <span className="block text-sm font-medium">{choice.title}</span>
              <span className="block text-xs text-muted">{choice.detail}</span>
            </span>
          </button>
        ))}
      </div>
    </SkillDialog>
  );
}

function RawSkillDialog({
  busy,
  onSave,
  onClose,
}: {
  busy: boolean;
  onSave: (content: string) => void;
  onClose: () => void;
}) {
  const [content, setContent] = useState(TEMPLATE);
  const edited = content !== TEMPLATE;
  return (
    <SkillDialog
      wide
      title="Write SKILL.md"
      subtitle="The template is real text. Replace it, keep the frontmatter, and save."
      onClose={onClose}
    >
      <Textarea
        value={content}
        onChange={(event) => setContent(event.target.value)}
        aria-label="SKILL.md content"
        spellCheck={false}
        className="min-h-0 flex-1 resize-none font-mono text-xs leading-relaxed"
      />
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={busy || !edited}
          onClick={() => onSave(content)}
        >
          {busy ? <Spinner label="Saving" /> : "Save skill"}
        </Button>
      </div>
    </SkillDialog>
  );
}

function FormSkillDialog({
  busy,
  onSave,
  onClose,
}: {
  busy: boolean;
  onSave: (draft: SkillDraft) => void;
  onClose: () => void;
}) {
  const [id, setId] = useState("my-skill");
  const [title, setTitle] = useState("My Skill");
  const [version, setVersion] = useState("1.0.0");
  const [summary, setSummary] = useState("");
  const [triggers, setTriggers] = useState("");
  const [tools, setTools] = useState("");
  const [python, setPython] = useState("");
  const [node, setNode] = useState("");
  const [body, setBody] = useState("# My Skill\n\nExplain when to use this skill and how to verify the result.\n");

  const list = (value: string) =>
    value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean);

  return (
    <SkillDialog wide title="Build from fields" subtitle="Frontmatter fields stay separate from the instruction body." onClose={onClose}>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">Id</span>
          <Input value={id} onChange={(event) => setId(event.target.value)} aria-label="Skill id" />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">Title</span>
          <Input value={title} onChange={(event) => setTitle(event.target.value)} aria-label="Skill title" />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">Version</span>
          <Input value={version} onChange={(event) => setVersion(event.target.value)} aria-label="Skill version" />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">Summary</span>
          <Input
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            aria-label="Skill summary"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">Triggers (comma separated)</span>
          <Input value={triggers} onChange={(event) => setTriggers(event.target.value)} aria-label="Skill triggers" />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">Tools (comma separated)</span>
          <Input value={tools} onChange={(event) => setTools(event.target.value)} aria-label="Required tools" />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">Python imports</span>
          <Input value={python} onChange={(event) => setPython(event.target.value)} aria-label="Python imports" />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="font-medium">Node imports</span>
          <Input value={node} onChange={(event) => setNode(event.target.value)} aria-label="Node imports" />
        </label>
      </div>
      <label className="mt-3 flex min-h-0 flex-1 flex-col gap-1 text-xs">
        <span className="font-medium">Instructions</span>
        <Textarea
          value={body}
          onChange={(event) => setBody(event.target.value)}
          aria-label="Skill instructions"
          spellCheck={false}
          className="min-h-0 flex-1 resize-none font-mono text-xs leading-relaxed"
        />
      </label>
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={busy || !id.trim() || !title.trim() || !summary.trim()}
          onClick={() =>
            onSave({
              id: id.trim(),
              title: title.trim(),
              version: version.trim() || "1.0.0",
              summary: summary.trim(),
              triggers: list(triggers),
              requires_tools: list(tools),
              requires_python: list(python),
              requires_node: list(node),
              body,
            })
          }
        >
          {busy ? <Spinner label="Saving" /> : "Save skill"}
        </Button>
      </div>
    </SkillDialog>
  );
}

type Creator = "menu" | "raw" | "form" | null;

export function SkillsPage() {
  const [skills, setSkills] = useState<SkillInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creator, setCreator] = useState<Creator>(null);
  const [busy, setBusy] = useState(false);

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

  const save = async (work: () => Promise<SkillInfo[]>) => {
    setBusy(true);
    try {
      setSkills(await work());
      setCreator(null);
    } catch (reason) {
      toast(errorText(reason));
    } finally {
      setBusy(false);
    }
  };

  const importPath = async (directory: boolean) => {
    try {
      const picked = await open({
        directory,
        multiple: false,
        filters: directory ? undefined : [{ name: "Skill", extensions: ["md"] }],
      });
      if (typeof picked === "string") {
        await save(() => api.skillsImport(picked));
      }
    } catch (reason) {
      toast(errorText(reason));
    }
  };

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

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <p className="max-w-xl text-xs text-muted">
          Skills load instructions on demand. Their scripts run inside the sandbox and follow the
          same approvals as any other command.
        </p>
        <Button size="sm" variant="primary" onClick={() => setCreator("menu")}>
          <Plus size={13} /> Add skill
        </Button>
      </div>
      {skills.length === 0 ? (
        <p className="text-sm text-muted">
          No user skills yet. PDF Workbench is bundled and should appear here after the app
          restarts; add your own with Add skill.
        </p>
      ) : (
        skills.map((skill) => (
          <SkillCard key={skill.id} skill={skill} onChange={setSkills} />
        ))
      )}
      {creator === "menu" && (
        <AddMenu
          busy={busy}
          onClose={() => setCreator(null)}
          onImportFile={() => void importPath(false)}
          onImportFolder={() => void importPath(true)}
          onWrite={() => setCreator("raw")}
          onForm={() => setCreator("form")}
        />
      )}
      {creator === "raw" && (
        <RawSkillDialog
          busy={busy}
          onClose={() => setCreator(null)}
          onSave={(content) => void save(() => api.skillsSaveRaw(content))}
        />
      )}
      {creator === "form" && (
        <FormSkillDialog
          busy={busy}
          onClose={() => setCreator(null)}
          onSave={(draft) => void save(() => api.skillsSaveDraft(draft))}
        />
      )}
    </div>
  );
}
