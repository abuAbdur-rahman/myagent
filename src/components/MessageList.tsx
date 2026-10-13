import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { useApp } from "../lib/store";
import { Markdown } from "./Markdown";
import { extractArtifacts, type Artifact } from "../lib/artifacts";
import { Button } from "./ui";
import type { Message } from "../lib/types";
import { cn } from "../lib/utils";

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-start justify-between gap-3 rounded-control border border-destroy/60 bg-destroy/10 px-3 py-2 text-sm text-alarm"
    >
      <span className="break-words">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        className="rounded-control px-1 text-alarm hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
        aria-label="Dismiss error"
      >
        ✕
      </button>
    </div>
  );
}

function MessageItem({
  message,
  streaming,
  onOpenArtifact,
}: {
  message: Message;
  streaming: boolean;
  onOpenArtifact: (artifact: Artifact) => void;
}) {
  const isAssistant = message.role === "assistant";
  const artifacts = useMemo(
    () => (isAssistant ? extractArtifacts(message.content) : []),
    [isAssistant, message.content],
  );
  const emptyStreaming = isAssistant && message.content.length === 0 && streaming;

  let body: ReactNode;
  if (emptyStreaming) {
    body = (
      <span className="inline-flex gap-1 text-text-faint" aria-label="Waiting for response">
        <span className="animate-pulse">●</span>
        <span className="animate-pulse [animation-delay:150ms]">●</span>
        <span className="animate-pulse [animation-delay:300ms]">●</span>
      </span>
    );
  } else if (isAssistant) {
    body = <Markdown content={message.content} />;
  } else {
    body = (
      <p className="whitespace-pre-wrap text-sm text-text-primary">{message.content}</p>
    );
  }

  return (
    <div className="group">
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-text-faint">
        {isAssistant ? "Assistant" : "You"}
      </div>
      <div
        className={cn(
          "rounded-panel border border-vault-line px-4 py-3",
          isAssistant ? "bg-vault-black" : "bg-vault-surface/60",
        )}
      >
        {body}
      </div>

      {artifacts.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {artifacts.map((artifact) => (
            <Button
              key={artifact.index}
              variant="secondary"
              size="sm"
              onClick={() => onOpenArtifact(artifact)}
            >
              Artifact · {artifact.lang}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}

export function MessageList({
  onOpenArtifact,
}: {
  onOpenArtifact: (artifact: Artifact) => void;
}) {
  const { messages, streaming, error, clearError, ready } = useApp();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({
      behavior: streaming ? "auto" : "smooth",
      block: "end",
    });
  }, [messages, streaming]);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
      {error && <ErrorBanner message={error} onDismiss={clearError} />}

      {ready && messages.length === 0 && !error && (
        <div className="flex flex-1 items-center justify-center py-24">
          <div className="max-w-md text-center">
            <h2 className="mb-2 text-lg font-semibold text-text-primary">
              Start a conversation
            </h2>
            <p className="text-sm text-text-muted">
              Pick a model, type a message, and responses stream in from your
              provider. Keys stay in Windows Credential Manager.
            </p>
          </div>
        </div>
      )}

      {messages.map((message) => (
        <MessageItem
          key={message.id}
          message={message}
          streaming={streaming}
          onOpenArtifact={onOpenArtifact}
        />
      ))}

      <div ref={bottomRef} />
    </div>
  );
}
