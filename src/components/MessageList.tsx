import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileCode,
  FileText,
  GitBranch,
  Globe,
  CircleAlert,
  ListChecks,
  Pencil,
  RefreshCw,
  Search,
  Terminal,
  ThumbsDown,
  ThumbsUp,
  Clock,
  Trash2,
  Volume2,
  Square,
  X,
  Wrench,
} from "lucide-react";
import { useApp } from "../lib/store";
import * as api from "../lib/api";
import { classifyStreamError, STREAM_ERROR_TITLES } from "../lib/api";
import { parseExtractedNotes } from "../lib/memory-extract";
import { toast } from "../lib/toast";
import { errorText, formatDuration } from "../lib/utils";
import { speakMessage, stopSpeaking, stopSpeakingFor, useSpeakingId, canReadAloud } from "../lib/read-aloud";
import { Markdown } from "./Markdown";
import { TipTapEditor } from "./composer/TipTapEditor";
import { splitArtifactSegments, type ContentSegment } from "../lib/artifacts";
import { splitOpenUISegments, type OpenUISegment } from "../lib/openui/segments";
import { splitVizSegments, type VizSegment } from "../lib/viz";
import { OpenUIRenderer } from "./openui/OpenUIRenderer";
import { InlineVisual } from "./InlineVisual";
import { parseDocAttachments, parseImageAttachments } from "../lib/attachments";
import { DocAttachmentCard } from "./AttachmentCard";
import { isKnownTool } from "../lib/tools";
import { isBinaryArtifact, selectOutputFiles } from "../lib/session";
import { copyWithToast } from "./ChatHeader";
import { Logo } from "./Logo";
import { Button, Dialog, IconButton } from "./ui";
import { confirmDialog } from "./ConfirmDialog";
import { cn } from "../lib/utils";
import { parseToolLog, parseDeclaredArtifacts } from "../lib/db";
import { groupToolEntries } from "../lib/tool-groups";
import type { Message, ToolLogEntry } from "../lib/types";

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const { canRetry, retryTurn, streaming } = useApp();
  const { hint } = classifyStreamError(message);
  return (
    <div
      role="alert"
      className="rounded-card bg-danger-soft p-3 text-sm shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--danger)_28%,transparent)]"
    >
      <div className="flex items-start gap-2.5">
        <CircleAlert size={16} className="mt-0.5 flex-none text-danger" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="m-0 font-semibold text-danger">{hint}</p>
          <details className="mt-1.5 text-xs text-fg-3">
            <summary className="cursor-pointer">Technical details</summary>
            <pre className="m-0 mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-field bg-code p-2 font-mono">
              {message}
            </pre>
          </details>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {canRetry && !streaming && (
            <Button size="sm" variant="secondary" onClick={() => void retryTurn()}>
              Retry
            </Button>
          )}
          <IconButton label="Dismiss error" size={28} onClick={onDismiss}>
            <X size={14} />
          </IconButton>
        </div>
      </div>
    </div>
  );
}

function AgentErrorCard({ message, retryable }: { message: string; retryable: boolean }) {
  const { retryTurn } = useApp();
  const { cls, hint } = classifyStreamError(message);
  return (
    <div
      role="alert"
      className="my-2 rounded-card bg-danger-soft p-3 text-sm shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--danger)_28%,transparent)]"
    >
      <div className="flex items-start gap-2.5">
        <CircleAlert size={16} className="mt-0.5 flex-none text-danger" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <p className="m-0 font-semibold text-danger">{STREAM_ERROR_TITLES[cls]}</p>
          <p className="m-0 mt-0.5 text-[13px] text-fg-2">{hint}</p>
          <details className="mt-1.5 text-xs text-fg-3">
            <summary className="cursor-pointer">Technical details</summary>
            <pre className="m-0 mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-field bg-code p-2 font-mono">
              {message}
            </pre>
          </details>
        </div>
        {retryable && (
          <Button size="sm" variant="secondary" onClick={() => void retryTurn()}>
            Retry
          </Button>
        )}
      </div>
    </div>
  );
}

function ToolIcon({ name }: { name: string }) {
  const props = { size: 14 } as const;
  if (!isKnownTool(name)) return <Wrench {...props} />;
  switch (name) {
    case "skill":
      return <BookOpen {...props} />;
    case "run_powershell":
      return <Terminal {...props} />;
    case "get_time":
      return <Clock {...props} />;
    case "save_artifact":
      return <FileCode {...props} />;
    case "remember":
    case "recall_memory":
    case "memory_pending":
      return <FileText {...props} />;
    case "update_memory":
      return <Pencil {...props} />;
    case "delete_memory":
      return <Trash2 {...props} />;
    case "web_fetch":
      return <Globe {...props} />;
    case "web_search":
      return <Search {...props} />;
    case "research_run":
      return <Globe {...props} />;
    case "todo_write":
    case "todo_set":
      return <ListChecks {...props} />;
    default:
      return <Wrench {...props} />;
  }
}

export function ToolLogView({
  entries,
  collapseToolCalls,
  resetKey,
}: {
  entries: ToolLogEntry[];
  collapseToolCalls: boolean;
  resetKey: string | null;
}) {
  const [collapsed, setCollapsed] = useState(collapseToolCalls);
  useEffect(() => {
    setCollapsed(collapseToolCalls);
  }, [resetKey, collapseToolCalls]);
  const rows = useMemo(() => groupToolEntries(entries), [entries]);
  if (entries.length === 0) return null;
  const running = entries.filter((e) => e.status === "running").length;
  const failed = entries.filter((e) => e.status === "err").length;
  return (
    <div
      className="rounded-card bg-fill-1 px-2 py-1.5 shadow-[inset_0_0_0_1px_var(--line-subtle)]"
      aria-live="polite"
    >
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Show tool calls" : "Hide tool calls"}
        className="group flex w-full items-center gap-2 py-0.5 text-left text-[13px] text-fg-3 hover:text-fg"
      >
        <Wrench size={14} />
        <span className="flex-1">
          {entries.length} tool call{entries.length === 1 ? "" : "s"}
          {running > 0 && ` · ${running} running`}
          {failed > 0 && ` · ${failed} failed`}
        </span>
        <span className="grid h-5 w-5 place-items-center rounded-chip">
          <ChevronDown
            size={14}
            className={cn("transition-transform", collapsed && "-rotate-90")}
            aria-hidden="true"
          />
        </span>
      </button>
      {!collapsed && (
        <div className="flex flex-col gap-0.5 pt-0.5">
          {rows.map((row) =>
            row.kind === "single" ? (
              <ToolEntryRow key={row.entry.id} entry={row.entry} />
            ) : (
              <details key={`group-${row.name}`} className="group text-[13px]">
                <summary className="flex cursor-pointer list-none items-center gap-2 rounded-chip py-0.5 text-fg-3 hover:text-fg">
                  <ToolIcon name={row.name} />
                  <span className="truncate">{row.label}</span>
                  <span className="text-fg-3">· {row.entries.length}</span>
                  {row.entries.some((entry) => entry.status === "err") && (
                    <span className="text-danger">
                      · {row.entries.filter((entry) => entry.status === "err").length} failed
                    </span>
                  )}
                  <ChevronDown
                    size={14}
                    className="ml-auto transition-transform group-open:rotate-180"
                    aria-hidden="true"
                  />
                </summary>
                <div className="ml-5 flex flex-col gap-0.5 border-l border-line-subtle pl-3">
                  {row.entries.map((entry) => (
                    <ToolEntryRow key={entry.id} entry={entry} />
                  ))}
                </div>
              </details>
            ),
          )}
        </div>
      )}
    </div>
  );
}

function ToolEntryRow({ entry }: { entry: ToolLogEntry }) {
  return (
    <details className="text-[13px]">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-chip py-0.5 text-fg-3 hover:text-fg">
        {entry.status === "running" && (
          <span
            role="status"
            aria-label="Running"
            className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-line-strong border-t-accent-text"
          />
        )}
        {entry.status === "ok" && (
          <span role="img" aria-label="Succeeded">
            <Check size={14} className="text-success" />
          </span>
        )}
        {entry.status === "err" && (
          <span role="img" aria-label="Failed">
            <X size={14} className="text-danger" />
          </span>
        )}
        <ToolIcon name={entry.name} />
        {entry.name === "skill" ? (
          <span className="truncate rounded-chip bg-accent-soft px-1.5 py-px text-xs text-accent-text">
            Using skill: {entry.summary.replace(/^Skill:\s*/, "").trim() || "unknown"}
          </span>
        ) : (
          <span className="truncate" title={entry.summary}>
            {entry.summary}
          </span>
        )}
      </summary>
      {entry.preview && (
        <pre className="m-0 mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-field bg-code p-2 font-mono text-xs text-fg-2">
          {entry.preview}
        </pre>
      )}
      <CheckpointActions entry={entry} />
    </details>
  );
}

function CheckpointActions({ entry }: { entry: ToolLogEntry }) {
  const checkpoint =
    /checkpoint:\s*(refs\/myagent\/pre-exec\/[A-Za-z0-9-]+)/.exec(entry.preview ?? "")?.[1] ?? null;
  const paths = useMemo(() => {
    const found = new Set<string>(entry.files ?? []);
    const summaryPath = /^(?:Write|Edit|Delete):\s*(.+)$/.exec(entry.summary)?.[1]?.trim();
    if (summaryPath) found.add(summaryPath);
    const section = /created files:\n([\s\S]*?)(?:\n\n|$)/.exec(entry.preview ?? "")?.[1] ?? "";
    for (const line of section.split("\n")) {
      const path = line.trim();
      if (path) found.add(path);
    }
    return [...found];
  }, [entry.files, entry.preview, entry.summary]);
  const [open, setOpen] = useState(false);
  const [diff, setDiff] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!checkpoint || entry.status !== "ok") return null;

  const show = async () => {
    setOpen(true);
    setLoading(true);
    setDiff(null);
    try {
      setDiff(await api.sandboxCheckpointDiff(checkpoint));
    } catch (error) {
      setDiff(errorText(error));
    } finally {
      setLoading(false);
    }
  };

  const restore = async () => {
    if (paths.length === 0) {
      toast("No file paths recorded for this step.");
      return;
    }
    const confirmed = await confirmDialog({
      title: "Restore these files?",
      body: `${paths.length} file${paths.length === 1 ? "" : "s"} will return to their state before this step. Later changes to them are lost.`,
      ok: "Restore",
      danger: true,
    });
    if (!confirmed) return;
    setBusy(true);
    try {
      const count = await api.sandboxCheckpointRestore(checkpoint, paths);
      toast(`Restored ${count} file${count === 1 ? "" : "s"}`);
      setOpen(false);
    } catch (error) {
      toast(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="mt-1 flex items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => void show()}>
          Changes
        </Button>
        {paths.length > 0 && (
          <span className="text-xs text-fg-3">
            {paths.length} file{paths.length === 1 ? "" : "s"}
          </span>
        )}
      </div>
      <Dialog open={open} onClose={() => setOpen(false)} title="Changes before this step" wide>
        <div className="flex min-h-0 flex-col gap-3">
          <pre className="m-0 max-h-[50vh] overflow-auto rounded-field bg-code p-3 font-mono text-xs text-fg-2">
            {loading ? "Loading…" : diff}
          </pre>
          <div className="flex justify-end gap-2">
            <Button variant="default" onClick={() => setOpen(false)}>
              Close
            </Button>
            <Button
              variant="dangerFill"
              disabled={busy || paths.length === 0}
              onClick={() => void restore()}
            >
              {busy ? "Restoring…" : "Restore files"}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

function ActionButton({
  label,
  title,
  onClick,
  active,
  pressed,
  children,
}: {
  label: string;
  title: string;
  onClick: () => void;
  active?: boolean;
  pressed?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      title={title}
      onClick={onClick}
      className={cn(
        "grid h-7 w-7 place-items-center rounded-field",
        active ? "bg-fill-2 text-accent-text" : "text-fg-3 hover:bg-fill-2 hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

export function MessageImages({ message }: { message: Message }) {
  const images = parseImageAttachments(message.attachments);
  if (images.length === 0) return null;
  return (
    <div className="mb-1 flex max-w-[80%] flex-wrap justify-end gap-1.5">
      {images.map((image, index) => (
        <img
          key={`${message.id}-${index}`}
          src={image.dataUrl}
          alt={`Attached image ${index + 1}`}
          className="h-32 w-32 rounded-control border border-border bg-surface object-cover"
        />
      ))}
    </div>
  );
}

export function MessageDocuments({ message }: { message: Message }) {
  const docs = parseDocAttachments(message.attachments);
  if (docs.length === 0) return null;
  return (
    <div className="mb-1 flex max-w-[80%] flex-wrap justify-end gap-1.5">
      {docs.map((doc, index) => (
        <DocAttachmentCard key={`${message.id}-doc-${index}`} doc={doc} />
      ))}
    </div>
  );
}

function UserMessage({
  message,
  onEdit,
}: {
  message: Message;
  onEdit: (id: string, text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);

  if (editing) {
    return (
      <div className="msg user flex flex-col items-end">
        <MessageImages message={message} />
        <MessageDocuments message={message} />
        <div className="w-[80%]">
          <div className="rounded-composer bg-raised px-3 py-2 shadow-[inset_0_0_0_1px_var(--accent-line),var(--shadow-sm)]">
            <TipTapEditor
              initialMarkdown={message.content}
              placeholder="Edit message"
              signal={null}
              onChangeMarkdown={setDraft}
              chat={null}
            />
          </div>
          <div className="mt-1.5 flex justify-end gap-2">
            <Button variant="default" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setEditing(false);
                void onEdit(message.id, draft);
              }}
            >
              Save &amp; Resubmit
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="msg user group flex flex-col items-end" data-mid={message.id}>
      <MessageImages message={message} />
      <MessageDocuments message={message} />
      <div className="max-w-[80%] break-words rounded-composer bg-raised px-4 py-2.5 shadow-[var(--shadow-sm)]">
        <Markdown content={message.content} />
      </div>
      <div className="mt-0.5 flex items-center gap-1">
        <VersionSwitcher messageId={message.id} />
        <div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <ActionButton label="Copy" title="Copy" onClick={() => void copyWithToast(message.content)}>
            <Copy size={14} />
          </ActionButton>
          <ActionButton
            label="Edit"
            title="Edit"
            onClick={() => {
              setDraft(message.content);
              setEditing(true);
            }}
          >
            <Pencil size={14} />
          </ActionButton>
        </div>
      </div>
    </div>
  );
}

function ThinkingBlock({
  message,
  live,
}: {
  message: Message;
  live: boolean;
}) {
  const { collapseThinking } = useApp();
  const [open, setOpen] = useState(live || !collapseThinking);
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current) setOpen(live || !collapseThinking);
  }, [live, collapseThinking]);
  if (!message.reasoning) return null;
  const seconds =
    message.thinking_ms != null ? Math.max(1, Math.round(message.thinking_ms / 1000)) : null;
  const title = live && seconds === null ? "Thinking…" : `Thought${seconds !== null ? ` for ${seconds} s` : ""}`;
  return (
    <div className="think">
      <button
        type="button"
        className="think-toggle"
        aria-expanded={open}
        aria-label={open ? "Hide thinking" : "Show thinking"}
        onClick={() => {
          touched.current = true;
          setOpen((v) => !v);
        }}
      >
        {title}
      </button>
      {open && <Markdown content={message.reasoning} streaming={live} />}
    </div>
  );
}

function ArtifactCard({
  id,
  title,
  lang,
  code,
}: {
  id: string;
  title: string;
  lang: string;
  code: string;
}) {
  const { panelOpen, panelArtifact, panelView, openArtifact, closePanel } = useApp();
  const isOpen = panelOpen && panelView === "artifact" && panelArtifact?.id === id;
  return (
    <button
      type="button"
      onClick={() => (isOpen ? closePanel() : openArtifact({ id, title, lang, code }))}
      className="my-1 flex w-full items-center gap-3 rounded-card bg-raised px-3 py-2.5 text-left shadow-[inset_0_0_0_1px_var(--line)] hover:shadow-[inset_0_0_0_1px_var(--line-strong)]"
    >
      <span className="grid h-9 w-9 flex-none place-items-center rounded-field bg-fill-2 text-fg-2">
        <FileCode size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className="block text-xs text-fg-3">
          {lang ? `${lang.toUpperCase()} · sandboxed` : "Sandboxed"}
        </span>
      </span>
      <ChevronRight size={16} className="flex-none text-fg-3" />
    </button>
  );
}

function isPreviewableFile(path: string): boolean {
  return /\.(pdf|docx|pptx|xlsx|odt|ods|odp)$/i.test(path);
}

function FileCard({ path }: { path: string }) {
  const { openArtifact } = useApp();
  const title = path.split(/[\\/]/).pop() || path;
  const lang = title.includes(".") ? title.split(".").pop()!.toLowerCase() : "file";
  return (
    <button
      type="button"
      onClick={() =>
        openArtifact({
          id: `file:${path}`,
          title,
          lang,
          code: "",
          path,
        })
      }
      className="my-1 flex w-full items-center gap-3 rounded-card bg-raised px-3 py-2.5 text-left shadow-[inset_0_0_0_1px_var(--line)] hover:shadow-[inset_0_0_0_1px_var(--line-strong)]"
    >
      <span className="grid h-9 w-9 flex-none place-items-center rounded-field bg-fill-2 text-fg-2">
        <FileText size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className="block truncate text-xs text-fg-3">Output · {path}</span>
      </span>
      <ChevronRight size={16} className="flex-none text-fg-3" />
    </button>
  );
}

function AssistantMessage({
  message,
  modelName,
  isLast,
  streaming,
  streamingId,
  resetKey,
  collapseToolCalls,
  outputFiles,
  onRemember,
}: {
  message: Message;
  modelName: string;
  isLast: boolean;
  streaming: boolean;
  streamingId: string | null;
  resetKey: string | null;
  collapseToolCalls: boolean;
  outputFiles: string[];
  onRemember: (message: Message) => Promise<boolean>;
}) {
  const live = streaming && streamingId === message.id;
  const { canRetry } = useApp();
  const baseSegments = useMemo(() => splitArtifactSegments(message.content), [message.content]);
  const segments = useMemo(() => {
    const out: (ContentSegment | OpenUISegment | VizSegment)[] = [];
    for (const segment of baseSegments) {
      if (segment.kind !== "text") {
        out.push(segment);
        continue;
      }
      for (const ui of splitOpenUISegments(segment.text, live)) {
        if (ui.kind !== "text") {
          out.push(ui);
          continue;
        }
        out.push(...splitVizSegments(ui.text, live));
      }
    }
    return out;
  }, [baseSegments, live]);
  const declared = useMemo(() => parseDeclaredArtifacts(message.artifacts), [message.artifacts]);
  const toolEntries = useMemo(() => parseToolLog(message.tool_log), [message.tool_log]);
  const [rememberLabel, setRememberLabel] = useState("Remember");
  const speakingId = useSpeakingId();
  const speaking = speakingId === message.id;
  const duration = message.duration_ms ?? null;
  const completedAt =
    message.completed_at ?? message.created_at + (duration ?? 0);
  const busy = live && message.content.length === 0;

  useEffect(() => {
    return () => stopSpeakingFor(message.id);
  }, [message.id]);

  const remember = async () => {
    setRememberLabel("Extracting…");
    try {
      const queued = await onRemember(message);
      setRememberLabel(queued ? "Queued" : "Nothing new");
    } catch {
      setRememberLabel("Remember failed");
    }
    setTimeout(() => setRememberLabel("Remember"), 1500);
  };

  return (
    <div className="msg group" data-mid={message.id}>
      <div className="mb-2 flex items-center gap-2 text-xs text-fg-3">
        <Logo size={16} alt="" className="rounded-full" />
        <span>{modelName}</span>
        {duration !== null && <span aria-hidden="true">·</span>}
        {duration !== null && <span className="tabular-nums">{formatDuration(duration)}</span>}
      </div>
      <div className="md">
        <ThinkingBlock message={message} live={live} />
        <ToolLogView
          entries={toolEntries}
          collapseToolCalls={collapseToolCalls}
          resetKey={resetKey}
        />
        {!busy && (
          <>
            {segments.map((segment, i) =>
              segment.kind === "text" ? (
                <Markdown key={i} content={segment.text} streaming={live} />
              ) : segment.kind === "openui" ? (
                <OpenUIRenderer
                  key={`openui-${i}`}
                  code={segment.code}
                  isStreaming={live && !segment.closed}
                />
              ) : segment.kind === "viz" ? (
                <InlineVisual
                  key={`viz-${i}`}
                  code={segment.code}
                  isStreaming={live && !segment.closed}
                />
              ) : (
                <ArtifactCard
                  key={`fence-${segment.artifact.index}`}
                  id={`${message.id}:fence:${segment.artifact.index}`}
                  title={`${segment.artifact.title}.html`}
                  lang={segment.artifact.lang}
                  code={segment.artifact.code}
                />
              ),
            )}
            {declared
              .filter(
                (artifact) =>
                  !isBinaryArtifact(artifact.lang) ||
                  !outputFiles.some((path) =>
                    path.toLowerCase().endsWith(`.${artifact.lang}`),
                  ),
              )
              .map((artifact, position) => (
              <ArtifactCard
                key={`tool-${position}`}
                id={`${message.id}:tool:${position}`}
                title={artifact.title}
                lang={artifact.lang}
                code={artifact.code}
              />
            ))}
            {outputFiles.filter(isPreviewableFile).map((path) => (
              <FileCard key={path} path={path} />
            ))}
            {live && <span className="caret" aria-hidden="true" />}
          </>
        )}
      </div>
      {message.error && (
        <AgentErrorCard message={message.error} retryable={isLast && !streaming && canRetry} />
      )}
      {!busy && (
        <>
          {isLast && (message.finish_reason === "step_limit" || message.finish_reason === "time_limit") && (
            <div className="mb-1 flex flex-wrap items-center gap-2 rounded-card bg-[var(--warning-soft)] px-3 py-2 text-xs text-warning">
              <span>
                {message.finish_reason === "time_limit"
                  ? "Paused: the turn budget was reached"
                  : "Paused: the 25-step cap was reached"}{" "}
                after {toolEntries.length} tool call
                {toolEntries.length === 1 ? "" : "s"}. The task may be unfinished.
              </span>
              <ContinueButton />
            </div>
          )}
          {isLast && (message.finish_reason === "length" || message.finish_reason === "interrupted") && (
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-warning">
              <span>{message.finish_reason === "length" ? "Stopped at the token limit — the reply may be cut off." : "Stream interrupted — partial reply kept."}</span>
              <ContinueButton />
            </div>
          )}
          {isLast && message.finish_reason === "stopped" && (
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-fg-3">
              <span>Stopped — partial reply kept.</span>
            </div>
          )}
          <div className="mt-1.5 flex items-center gap-1">
            <VersionSwitcher messageId={message.id} />
            <div className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
              <ActionButton label="Copy" title="Copy" onClick={() => void copyWithToast(message.content)}>
                <Copy size={14} />
              </ActionButton>
              {canReadAloud() && message.content.trim().length > 0 && (
                <ActionButton
                  label={speaking ? "Stop reading" : "Read aloud"}
                  title={speaking ? "Stop reading" : "Read aloud"}
                  active={speaking}
                  onClick={() =>
                    speaking ? stopSpeaking() : speakMessage(message.id, message.content)
                  }
                >
                  {speaking ? (
                    <Square size={13} fill="currentColor" />
                  ) : (
                    <Volume2 size={14} />
                  )}
                </ActionButton>
              )}
              {isLast && <RegenButton />}
              <BranchButton messageId={message.id} />
              <RatingButtons message={message} />
              <Button
                variant="ghost"
                size="sm"
                disabled={rememberLabel === "Extracting…"}
                onClick={() => void remember()}
              >
                {rememberLabel}
              </Button>
            </div>
            <span
              className="ml-auto text-xs tabular-nums text-fg-3"
              title={new Date(completedAt).toLocaleString()}
            >
              {new Date(completedAt).toLocaleTimeString(undefined, {
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

function RegenButton() {
  const { regenerate, streaming } = useApp();
  if (streaming) return null;
  return (
    <ActionButton label="Regenerate" title="Regenerate" onClick={() => void regenerate()}>
      <RefreshCw size={14} />
    </ActionButton>
  );
}

function ContinueButton() {
  const { continueTurn, streaming } = useApp();
  if (streaming) return null;
  return (
    <Button
      size="sm"
      variant="default"
      title="Continue the unfinished task"
      onClick={() => void continueTurn()}
    >
      Continue
    </Button>
  );
}

function BranchButton({ messageId }: { messageId: string }) {
  const { branchFrom, streaming } = useApp();
  if (streaming) return null;
  return (
    <ActionButton label="Branch" title="Branch" onClick={() => void branchFrom(messageId)}>
      <GitBranch size={14} />
    </ActionButton>
  );
}

function VersionSwitcher({ messageId }: { messageId: string }) {
  const { messageVersions, switchVersion, streaming } = useApp();
  const info = messageVersions[messageId];
  if (!info || streaming) return null;
  return (
    <div
      className="flex items-center gap-0.5 text-xs text-fg-3"
      role="group"
      aria-label="Message versions"
    >
      <ActionButton
        label="Previous version"
        title="Previous version"
        onClick={() => void switchVersion(messageId, -1)}
      >
        <ChevronLeft size={14} />
      </ActionButton>
      <span className="tabular-nums">
        {info.index}/{info.total}
      </span>
      <ActionButton
        label="Next version"
        title="Next version"
        onClick={() => void switchVersion(messageId, 1)}
      >
        <ChevronRight size={14} />
      </ActionButton>
    </div>
  );
}

function RatingButtons({ message }: { message: Message }) {
  const { rateMessage } = useApp();
  return (
    <>
      <ActionButton
        label="Good reply"
        title="Good reply"
        pressed={message.rating === 1}
        active={message.rating === 1}
        onClick={() => void rateMessage(message.id, 1)}
      >
        <ThumbsUp size={14} />
      </ActionButton>
      <ActionButton
        label="Bad reply"
        title="Bad reply"
        pressed={message.rating === -1}
        active={message.rating === -1}
        onClick={() => void rateMessage(message.id, -1)}
      >
        <ThumbsDown size={14} />
      </ActionButton>
    </>
  );
}

export function MessageList() {
  const {
    messages,
    streaming,
    streamingId,
    error,
    clearError,
    ready,
    activeConnection,
    model,
    queueMemories,
    editAndResubmit,
    conversations,
    activeConversationId,
    collapseToolCalls,
  } = useApp();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [stuck, setStuck] = useState(true);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
      setStuck(true);
    }
  }, []);

  useEffect(() => {
    if (stuck) scrollToBottom();
  }, [messages, streaming, stuck, scrollToBottom]);

  useEffect(() => {
    return () => stopSpeaking();
  }, [activeConversationId]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    setStuck(nearBottom);
  };

  const remember = useCallback(
    async (message: Message): Promise<boolean> => {
      if (!activeConnection || !model) {
        toast("Choose a provider and model first.");
        return false;
      }
      const raw = await api.extractMemory(
        activeConnection.id,
        model,
        message.content,
        activeConnection.kind,
      );
      const notes = (() => {
        try {
          return parseExtractedNotes(raw);
        } catch (error) {
          toast(errorText(error));
          throw error;
        }
      })();
      if (notes.length === 0) {
        toast("No durable notes found in this reply.");
        return false;
      }
      const rows = await queueMemories(notes);
      toast(`${rows.length} ${rows.length === 1 ? "note" : "notes"} queued for review.`);
      return rows.length > 0;
    },
    [activeConnection, model, queueMemories],
  );

  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id;
  const outputFilesByMessage = useMemo(() => {
    const allPaths = messages.flatMap((message) =>
      parseToolLog(message.tool_log).flatMap((entry) => entry.files ?? []),
    );
    const selected = new Set(selectOutputFiles(allPaths));
    const map = new Map<string, string[]>();
    for (const message of messages) {
      const own = parseToolLog(message.tool_log).flatMap((entry) => entry.files ?? []);
      map.set(
        message.id,
        selectOutputFiles(own).filter((path) => selected.has(path)),
      );
    }
    return map;
  }, [messages]);
  const activeConversation =
    conversations.find((c) => c.id === activeConversationId) ?? null;
  const activeModel = activeConversation?.model ?? null;

  return (
    <>
      <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[720px] flex-col gap-[var(--msg-gap)] px-6 py-4">
        {error && (
          <div>
            <ErrorBanner message={error} onDismiss={clearError} />
          </div>
        )}

        {ready && messages.length === 0 && !error && (
          <div className="flex items-center justify-center py-24">
            <p className="text-sm text-muted">No messages yet.</p>
          </div>
        )}

        {activeConversation?.summary && (
          <div className="flex items-center gap-3 text-xs text-fg-3">
            <span className="h-px flex-1 bg-line-subtle" aria-hidden="true" />
            <span>Context compacted - earlier messages summarized</span>
            <span className="h-px flex-1 bg-line-subtle" aria-hidden="true" />
          </div>
        )}

        {messages.map((message) =>
          message.role === "user" ? (
            <UserMessage
              key={message.id}
              message={message}
              onEdit={(id, text) => editAndResubmit(id, text)}
            />
          ) : (
            <AssistantMessage
              key={message.id}
              message={message}
              modelName={message.model ?? activeModel ?? "assistant"}
              isLast={message.id === lastAssistantId}
              streaming={streaming}
              streamingId={streamingId}
              resetKey={activeConversationId}
              collapseToolCalls={collapseToolCalls}
              outputFiles={outputFilesByMessage.get(message.id) ?? []}
              onRemember={remember}
            />
          ),
        )}
      </div>
      </div>

      {!stuck && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-3 left-1/2 z-10 flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-full bg-overlay px-3.5 text-[13px] font-medium text-fg shadow-[var(--shadow-md)] ring-1 ring-line-strong hover:bg-fill-3"
        >
          <ArrowDown size={14} /> Jump to latest
        </button>
      )}
    </>
  );
}
