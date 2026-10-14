import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowDown,
  Check,
  Copy,
  FileCode,
  FileText,
  GitBranch,
  Pencil,
  RefreshCw,
  Sparkles,
  StepForward,
  Terminal,
  Clock,
  X,
  Wrench,
} from "lucide-react";
import { useApp } from "../lib/store";
import { classifyStreamError } from "../lib/api";
import { Markdown } from "./Markdown";
import { TipTapEditor } from "./composer/TipTapEditor";
import { extractArtifacts } from "../lib/artifacts";
import { isKnownTool } from "../lib/tools";
import { copyWithToast } from "./ChatHeader";
import { Button } from "./ui";
import type { Message } from "../lib/types";
import { cn } from "../lib/utils";

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  const { canRetry, retryTurn, streaming } = useApp();
  const { hint } = classifyStreamError(message);
  return (
    <div
      role="alert"
      className="rounded-control border border-danger/60 bg-danger/10 px-3 py-2 text-sm text-danger"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="break-words">{hint}</span>
        <div className="flex shrink-0 items-center gap-1">
          {canRetry && !streaming && (
            <button
              type="button"
              onClick={() => void retryTurn()}
              className="rounded-control border border-danger/60 px-2 py-0.5 text-xs hover:bg-danger/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Retry
            </button>
          )}
          <button
            type="button"
            onClick={onDismiss}
            className="rounded-control px-1 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      </div>
      <details className="mt-1 text-xs opacity-80">
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
    case "run_powershell":
      return <Terminal {...props} />;
    case "get_time":
      return <Clock {...props} />;
    case "save_artifact":
      return <FileCode {...props} />;
    case "remember":
    case "recall_memory":
      return <FileText {...props} />;
    default:
      return <Wrench {...props} />;
  }
}

function ToolLogView() {
  const { toolLog } = useApp();
  if (toolLog.length === 0) return null;
  return (
    <div
      className="mb-6 flex flex-col gap-1 rounded-card border border-border bg-surface px-3 py-2"
      aria-live="polite"
    >
      {toolLog.map((entry) => (
        <details key={entry.id} className="text-[13px]">
          <summary className="flex cursor-pointer list-none items-center gap-2 py-0.5 text-muted hover:text-text">
            {entry.status === "running" && (
              <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-muted border-t-transparent" />
            )}
            {entry.status === "ok" && <Check size={14} className="text-success" />}
            {entry.status === "err" && <X size={14} className="text-danger" />}
            <ToolIcon name={entry.name} />
            <span className="truncate">{entry.summary}</span>
          </summary>
          {entry.preview && (
            <pre className="m-0 mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-control bg-vault-raised p-2 font-mono text-xs text-text">
              {entry.preview}
            </pre>
          )}
        </details>
      ))}
    </div>
  );
}

function ActionButton({
  label,
  title,
  onClick,
  active,
  children,
}: {
  label: string;
  title: string;
  onClick: () => void;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
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

function ApprovalCard() {
  const { approval, replyApproval } = useApp();
  if (!approval) return null;
  return (
    <div
      role="alertdialog"
      aria-label="Tool approval"
      className="mb-2 rounded-control border border-warn/60 bg-warn/10 px-3 py-2 text-sm"
    >
      <div className="font-medium">
        Allow <span className="font-mono">{approval.tool}</span> to run?
      </div>
      {approval.command && (
        <pre className="m-0 mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-control bg-vault-raised p-2 font-mono text-xs text-text">
          {approval.command}
        </pre>
      )}
      {approval.cwd && <div className="mt-1 text-xs text-muted">in {approval.cwd}</div>}
      <div className="mt-2 flex gap-2">
        <Button size="sm" variant="default" onClick={() => void replyApproval("once")}>
          Allow once
        </Button>
        <Button size="sm" variant="default" onClick={() => void replyApproval("always")}>
          Always
        </Button>
        <Button size="sm" variant="ghost" onClick={() => void replyApproval("deny")}>
          Deny
        </Button>
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
  if (!message.reasoning) return null;
  const seconds =
    message.thinking_ms != null ? Math.max(1, Math.round(message.thinking_ms / 1000)) : null;
  const title = live && seconds === null ? "Thinking…" : `Thought${seconds !== null ? ` for ${seconds} s` : ""}`;
  return (
    <details className="think" open={live}>
      <summary>{title}</summary>
      <Markdown content={message.reasoning} />
    </details>
  );
}

function AssistantMessage({
  message,
  modelName,
  isLast,
  streaming,
  onRemember,
}: {
  message: Message;
  modelName: string;
  isLast: boolean;
  streaming: boolean;
  onRemember: (content: string) => Promise<void>;
}) {
  const { openArtifact } = useApp();
  const artifacts = useMemo(() => extractArtifacts(message.content), [message.content]);
  const [showAllArtifacts, setShowAllArtifacts] = useState(false);
  const [rememberLabel, setRememberLabel] = useState("Remember");
  const busy = streaming && message.content.length === 0;
  const visibleArtifacts = showAllArtifacts ? artifacts : artifacts.slice(0, 3);
  const hiddenCount = artifacts.length - visibleArtifacts.length;

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
        <span className="grid h-[22px] w-[22px] place-items-center rounded-full bg-accent text-accent-contrast">
          <Sparkles size={12} />
        </span>
        <span className="text-muted">{modelName}</span>
      </div>
      <div className="md">
        <ThinkingBlock message={message} live={isLast && streaming} />
        {isLast && <ToolLogView />}
        {isLast && <ApprovalCard />}
        {busy ? (
          <span className="dots" aria-label="Waiting for response">
            <i />
            <i />
            <i />
          </span>
        ) : (
          <>
            <Markdown content={message.content} />
            {streaming && <span className="caret" aria-hidden="true" />}
          </>
        )}
      </div>
      {!busy && (
        <>
          {isLast && message.finish_reason === "length" && (
            <div className="mb-1 text-xs text-warn">
              Stopped at the token limit — the reply may be cut off.
            </div>
          )}
          <div className="mt-1 flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <ActionButton label="Copy" title="Copy" onClick={() => void copyWithToast(message.content)}>
              <Copy size={14} />
            </ActionButton>
            {isLast && message.finish_reason === "length" && <ContinueButton />}
            {isLast && <RegenButton />}
            <BranchButton messageId={message.id} />
            <Button variant="ghost" size="sm" onClick={() => void remember()}>
              {rememberLabel}
            </Button>
          </div>
          {artifacts.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {visibleArtifacts.map((artifact, position) => (
                <Button
                  key={artifact.index}
                  variant="default"
                  size="sm"
                  onClick={() => openArtifact(artifact)}
                >
                  {artifacts.length > 1 ? `${position + 1} · ` : ""}Artifact · {artifact.lang}
                </Button>
              ))}
              {hiddenCount > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setShowAllArtifacts(true)}>
                  +{hiddenCount} more
                </Button>
              )}
            </div>
          )}
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
    <ActionButton label="Continue" title="Continue the cut-off reply" onClick={() => void continueTurn()}>
      <StepForward size={14} />
    </ActionButton>
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

export function MessageList() {
  const {
    messages,
    streaming,
    error,
    clearError,
    ready,
    activeProject,
    addMemory,
    editAndResubmit,
    conversations,
    activeConversationId,
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
  const activeModel =
    conversations.find((c) => c.id === activeConversationId)?.model ?? null;

  return (
    <div ref={scrollRef} onScroll={onScroll} className="relative h-full overflow-y-auto">
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

        {messages.map((message) =>
          message.role === "user" ? (
            <div key={message.id} className="mb-6">
              <UserMessage
                message={message}
                onEdit={(id, text) => editAndResubmit(id, text)}
              />
            </div>
          ) : (
            <div key={message.id} className="mb-6">
              <AssistantMessage
                message={message}
                modelName={activeModel ?? "assistant"}
                isLast={message.id === lastAssistantId}
                streaming={streaming}
                onRemember={remember}
              />
            </div>
          ),
        )}
      </div>

      {!stuck && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-[150px] left-1/2 flex h-8 -translate-x-1/2 items-center gap-1.5 rounded-control border border-border bg-surface px-3 text-[13px] shadow-[var(--shadow)] hover:bg-hover"
        >
          <ArrowDown size={14} /> Jump to latest
        </button>
      )}
    </div>
  );
}
