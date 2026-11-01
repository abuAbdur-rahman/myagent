import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  FileCode,
  FileText,
  GitBranch,
  Globe,
  ListChecks,
  Pencil,
  RefreshCw,
  Search,
  Terminal,
  ThumbsDown,
  ThumbsUp,
  Clock,
  Trash2,
  X,
  Wrench,
} from "lucide-react";
import { useApp } from "../lib/store";
import { classifyStreamError } from "../lib/api";
import { Markdown } from "./Markdown";
import { TipTapEditor } from "./composer/TipTapEditor";
import { splitArtifactSegments } from "../lib/artifacts";
import { parseDocAttachments, parseImageAttachments } from "../lib/attachments";
import { DocAttachmentCard } from "./AttachmentCard";
import { isKnownTool } from "../lib/tools";
import { copyWithToast } from "./ChatHeader";
import { Logo } from "./Logo";
import { Button, IconButton } from "./ui";
import { cn } from "../lib/utils";
import { parseToolLog, parseDeclaredArtifacts } from "../lib/db";
import type { Message, ToolLogEntry } from "../lib/types";

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const { canRetry, retryTurn, streaming } = useApp();
  const { hint } = classifyStreamError(message);
  return (
    <div
      role="alert"
      className="rounded-control border border-danger/60 bg-danger/10 px-3 py-2 text-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="break-words font-medium text-danger">{hint}</span>
        <div className="flex shrink-0 items-center gap-1">
          {canRetry && !streaming && (
            <Button size="sm" variant="danger" onClick={() => void retryTurn()}>
              Retry
            </Button>
          )}
          <IconButton label="Dismiss error" size={24} onClick={onDismiss}>
            <X size={14} />
          </IconButton>
        </div>
      </div>
      <details className="mt-1 text-xs text-danger opacity-80">
        <summary className="cursor-pointer">Raw error</summary>
        <pre className="m-0 mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words">
          {message}
        </pre>
      </details>
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
  if (entries.length === 0) return null;
  const running = entries.filter((e) => e.status === "running").length;
  const failed = entries.filter((e) => e.status === "err").length;
  return (
    <div
      className="mb-6 rounded-card border border-border bg-surface px-3 py-2"
      aria-live="polite"
    >
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        aria-expanded={!collapsed}
        aria-label={collapsed ? "Show tool calls" : "Hide tool calls"}
        className="group flex w-full items-center gap-2 py-0.5 text-left text-[13px] text-muted hover:text-text"
      >
        <Wrench size={14} />
        <span className="flex-1">
          {entries.length} tool call{entries.length === 1 ? "" : "s"}
          {running > 0 && ` · ${running} running`}
          {failed > 0 && ` · ${failed} failed`}
        </span>
        <span className="visible grid h-5 w-5 place-items-center rounded-control opacity-40 focus-visible:opacity-100 group-hover:opacity-100">
          {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </span>
      </button>
      {!collapsed && (
        <div className="flex flex-col gap-1">
          {entries.map((entry) => (
            <details key={entry.id} className="text-[13px]">
              <summary className="flex cursor-pointer list-none items-center gap-2 py-0.5 text-muted hover:text-text">
                {entry.status === "running" && (
                  <span
                    role="status"
                    aria-label="Running"
                    className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-muted border-t-transparent"
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
                  <span className="truncate rounded bg-active px-1.5 py-px text-xs text-accent">
                    Using skill: {entry.summary.replace(/^Skill:\s*/, "").trim() || "unknown"}
                  </span>
                ) : (
                  <span className="truncate" title={entry.summary}>
                    {entry.summary}
                  </span>
                )}
              </summary>
              {entry.preview && (
                <pre className="m-0 mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-control bg-vault-raised p-2 font-mono text-xs text-text">
                  {entry.preview}
                </pre>
              )}
            </details>
          ))}
        </div>
      )}
    </div>
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
        "grid h-7 w-7 place-items-center rounded-control",
        active ? "text-accent" : "text-muted hover:text-text",
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
          <div className="rounded-card border border-accent bg-surface-2 px-2.5 py-2">
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
      <div className="max-w-[80%] break-words rounded-composer border border-border bg-surface-2 px-3.5 py-2.5">
        <Markdown content={message.content} />
      </div>
      <div className="mt-1 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
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
      {open && <Markdown content={message.reasoning} />}
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
    <div className="my-3 flex items-center gap-3 rounded-panel border border-border bg-vault px-3 py-2.5">
      <span className="grid h-9 w-9 flex-none place-items-center rounded-control bg-active">
        <FileCode size={16} className="text-muted" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted">Artifact · {lang}</span>
      </span>
      <Button
        variant={isOpen ? "ghost" : "default"}
        size="sm"
        onClick={() => (isOpen ? closePanel() : openArtifact({ id, title, lang, code }))}
      >
        {isOpen ? "Hide" : "Open"}
      </Button>
    </div>
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
  onRemember,
}: {
  message: Message;
  modelName: string;
  isLast: boolean;
  streaming: boolean;
  streamingId: string | null;
  resetKey: string | null;
  collapseToolCalls: boolean;
  onRemember: (content: string) => Promise<void>;
}) {
  const live = streaming && streamingId === message.id;
  const segments = useMemo(() => splitArtifactSegments(message.content), [message.content]);
  const fenceCount = segments.filter((s) => s.kind === "artifact").length;
  const declared = useMemo(() => parseDeclaredArtifacts(message.artifacts), [message.artifacts]);
  const toolEntries = useMemo(() => parseToolLog(message.tool_log), [message.tool_log]);
  const [rememberLabel, setRememberLabel] = useState("Remember");
  const busy = live && message.content.length === 0;

  const remember = async () => {
    try {
      await onRemember(message.content);
      setRememberLabel("Remembered");
    } catch {
      setRememberLabel("Remember failed");
    }
    setTimeout(() => setRememberLabel("Remember"), 1500);
  };

  return (
    <div className="msg group" data-mid={message.id}>
      <div className="mb-1.5 flex items-center gap-2 text-xs">
        <Logo size={22} alt="" className="rounded-full" />
        <span className="text-muted">{modelName}</span>
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
                <Markdown key={i} content={segment.text} />
              ) : (
                <ArtifactCard
                  key={`fence-${segment.artifact.index}`}
                  id={`${message.id}:fence:${segment.artifact.index}`}
                  title={fenceCount > 1 ? `artifact-${segment.artifact.index + 1}.html` : "artifact.html"}
                  lang={segment.artifact.lang}
                  code={segment.artifact.code}
                />
              ),
            )}
            {declared.map((artifact, position) => (
              <ArtifactCard
                key={`tool-${position}`}
                id={`${message.id}:tool:${position}`}
                title={artifact.title}
                lang={artifact.lang}
                code={artifact.code}
              />
            ))}
            {live && <span className="caret" aria-hidden="true" />}
          </>
        )}
      </div>
      {!busy && (
        <>
          {isLast && (message.finish_reason === "length" || message.finish_reason === "interrupted") && (
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-warn">
              <span>{message.finish_reason === "length" ? "Stopped at the token limit — the reply may be cut off." : "Stream interrupted — partial reply kept."}</span>
              <ContinueButton />
            </div>
          )}
          {isLast && message.finish_reason === "stopped" && (
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-muted">
              <span>Stopped — partial reply kept.</span>
            </div>
          )}
          <div className="mt-1 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <ActionButton label="Copy" title="Copy" onClick={() => void copyWithToast(message.content)}>
              <Copy size={14} />
            </ActionButton>
            {isLast && <RegenButton />}
            <BranchButton messageId={message.id} />
            <RatingButtons message={message} />
            <Button variant="ghost" size="sm" onClick={() => void remember()}>
              {rememberLabel}
            </Button>
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
      title="Continue the cut-off reply"
      onClick={() => void continueTurn()}
    >
      Continue reply
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
    activeProject,
    addMemory,
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

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    setStuck(nearBottom);
  };

  const remember = useCallback(
    async (content: string) => {
      await addMemory({
        scope: activeProject ? "project" : "global",
        project_id: activeProject ? activeProject.id : null,
        kind: "summary",
        content: content.slice(0, 2000),
      });
    },
    [addMemory, activeProject],
  );

  const lastAssistantId = [...messages].reverse().find((m) => m.role === "assistant")?.id;
  const activeConversation =
    conversations.find((c) => c.id === activeConversationId) ?? null;
  const activeModel = activeConversation?.model ?? null;

  return (
    <>
      <div ref={scrollRef} onScroll={onScroll} className="h-full overflow-y-auto">
        <div className="mx-auto w-full max-w-[760px] px-4 py-6">
        {error && (
          <div className="mb-6">
            <ErrorBanner message={error} onDismiss={clearError} />
          </div>
        )}

        {ready && messages.length === 0 && !error && (
          <div className="flex items-center justify-center py-24">
            <p className="text-sm text-muted">No messages yet.</p>
          </div>
        )}

        {activeConversation?.summary && (
          <div className="mb-6 flex items-center gap-3 text-xs text-muted">
            <span className="h-px flex-1 bg-border" aria-hidden="true" />
            <span>Context compacted - earlier messages summarized</span>
            <span className="h-px flex-1 bg-border" aria-hidden="true" />
          </div>
        )}

        {messages.map((message) =>
          message.role === "user" ? (
            <div key={message.id} className="mb-[var(--msg-gap)]">
              <UserMessage
                message={message}
                onEdit={(id, text) => editAndResubmit(id, text)}
              />
            </div>
          ) : (
            <div key={message.id} className="mb-[var(--msg-gap)]">
              <AssistantMessage
                message={message}
                modelName={message.model ?? activeModel ?? "assistant"}
                isLast={message.id === lastAssistantId}
                streaming={streaming}
                streamingId={streamingId}
                resetKey={activeConversationId}
                collapseToolCalls={collapseToolCalls}
                onRemember={remember}
              />
            </div>
          ),
        )}
      </div>
      </div>

      {!stuck && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-4 left-1/2 z-10 flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-control border border-border bg-surface px-3 text-[13px] shadow-[var(--shadow)] hover:bg-hover"
        >
          <ArrowDown size={14} /> Jump to latest
        </button>
      )}
    </>
  );
}
