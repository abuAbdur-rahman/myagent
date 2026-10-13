import { useEffect, useRef } from "react";
import { useApp } from "../lib/store";
import { Markdown } from "./Markdown";
import { extractArtifacts, type Artifact } from "../lib/artifacts";
import { Button } from "./ui";
import { cn } from "../lib/utils";

export function MessageList({
  onOpenArtifact,
}: {
  onOpenArtifact: (artifact: Artifact) => void;
}) {
  const { messages, streaming, error, clearError, ready } = useApp();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  if (ready && messages.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="max-w-md text-center">
          <h2 className="mb-2 text-lg font-semibold text-neutral-200">
            Start a conversation
          </h2>
          <p className="text-sm text-neutral-500">
            Pick a model, type a message, and responses stream in from your
            provider. Keys stay in Windows Credential Manager.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
      {error && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-md border border-red-900 bg-red-950/50 px-3 py-2 text-sm text-red-300"
        >
          <span className="break-words">{error}</span>
          <button
            type="button"
            onClick={clearError}
            className="text-red-400 hover:text-red-200"
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}

      {messages.map((message) => {
        const artifacts =
          message.role === "assistant" ? extractArtifacts(message.content) : [];
        const isEmptyStreaming =
          message.role === "assistant" && message.content.length === 0 && streaming;

        return (
          <div key={message.id} className="group">
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
              {message.role === "user" ? "You" : "Assistant"}
            </div>
            <div
              className={cn(
                "rounded-lg border px-4 py-3",
                message.role === "user"
                  ? "border-neutral-800 bg-neutral-900/60"
                  : "border-neutral-800 bg-neutral-950",
              )}
            >
              {isEmptyStreaming ? (
                <span className="inline-flex gap-1 text-neutral-500">
                  <span className="animate-pulse">●</span>
                  <span className="animate-pulse [animation-delay:150ms]">●</span>
                  <span className="animate-pulse [animation-delay:300ms]">●</span>
                </span>
              ) : message.role === "user" ? (
                <p className="whitespace-pre-wrap text-sm text-neutral-200">
                  {message.content}
                </p>
              ) : (
                <Markdown content={message.content} />
              )}
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
      })}

      <div ref={bottomRef} />
    </div>
  );
}
