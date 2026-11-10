import {
  Check,
  ChevronRight,
  Circle,
  CircleDot,
  FileText,
  Globe,
  ImageIcon,
  Wrench,
  X,
} from "lucide-react";

import { useApp } from "../lib/store";
import { cn } from "../lib/utils";
import {
  sessionOutputs,
  sessionUsage,
  stepProgress,
  type SessionOutput,
} from "../lib/session";
import type { TodoStatus } from "../lib/types";
import { ArtifactThumb } from "./ArtifactThumb";

function StatusIcon({ status }: { status: TodoStatus }) {
  switch (status) {
    case "completed":
      return <Check size={14} className="text-success" />;
    case "in_progress":
      return <CircleDot size={14} className="text-accent" />;
    case "cancelled":
      return <X size={14} className="text-fg-3" />;
    default:
      return <Circle size={14} className="text-fg-3" />;
  }
}

function Section({
  title,
  count,
  empty,
  hideCount,
  children,
}: {
  title: string;
  count?: number;
  empty: string;
  hideCount?: boolean;
  children: React.ReactNode;
}) {
  const isEmpty = count === 0;
  return (
    <section className="border-b border-line-subtle px-3.5 py-3 last:border-b-0">
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="m-0 text-[11px] font-semibold uppercase tracking-wider text-fg-3">
          {title}
        </h3>
        {!hideCount && typeof count === "number" && count > 0 && (
          <span className="text-[11px] tabular-nums text-fg-3">
            {count} {count === 1 ? "item" : "items"}
          </span>
        )}
      </div>
      {isEmpty ? <p className="m-0 text-xs text-fg-3">{empty}</p> : children}
    </section>
  );
}

function OutputCard({ output }: { output: SessionOutput }) {
  const { openArtifact } = useApp();
  return (
    <button
      type="button"
      onClick={() =>
        openArtifact({
          id: output.artifactId ?? output.key,
          title: output.title,
          lang: output.lang,
          code: output.code,
          messageId: output.messageId,
          locator: output.locator,
        })
      }
      className="flex w-full flex-col gap-1.5 rounded-card border border-line-subtle bg-surface p-1.5 text-left hover:border-accent/60 hover:bg-fill-2"
    >
      <ArtifactThumb artifact={output} />
      <span className="flex items-center gap-1 px-0.5">
        <span className="min-w-0 flex-1 truncate text-xs">{output.title}</span>
        <span className="flex-none rounded bg-fill-2 px-1 py-0.5 text-[10px] uppercase text-fg-3">
          {output.lang || "text"}
        </span>
      </span>
    </button>
  );
}

function OutputRow({ output }: { output: SessionOutput }) {
  const { openArtifact } = useApp();
  if (output.kind === "file") {
    return (
      <div
        className="flex items-center gap-2 rounded-control px-1 py-1 text-xs"
        title={output.title}
      >
        <FileText size={13} className="flex-none text-fg-3" />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{output.title}</span>
        <span className="flex-none rounded bg-fill-2 px-1 py-0.5 text-[10px] uppercase text-fg-3">
          {output.lang || "file"}
        </span>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() =>
        openArtifact({
          id: output.artifactId ?? output.key,
          title: output.title,
          lang: output.lang,
          code: output.code,
          messageId: output.messageId,
          locator: output.locator,
        })
      }
      className="flex w-full items-center gap-2 rounded-control px-1 py-1 text-left text-xs hover:bg-fill-2"
    >
      <FileText size={13} className="flex-none text-fg-3" />
      <span className="min-w-0 flex-1 truncate">{output.title}</span>
      <span className="flex-none rounded bg-fill-2 px-1 py-0.5 text-[10px] uppercase text-fg-3">
        {output.lang || "text"}
      </span>
      <ChevronRight size={13} className="flex-none text-fg-3" />
    </button>
  );
}

export function SessionPanel() {
  const { todos, messages, closePanel } = useApp();

  const progress = stepProgress(todos);
  const outputs = sessionOutputs(messages);
  const usage = sessionUsage(messages);
  const cards = outputs.filter((output) => output.kind === "artifact").slice(0, 2);
  const rows = outputs.filter((output) => !cards.includes(output));
  const toolSummary =
    usage.tools.length > 3
      ? `${usage.tools.slice(0, 3).map((tool) => tool.name).join(", ")} +${usage.tools.length - 3}`
      : usage.tools.map((tool) => tool.name).join(", ");

  return (
    <section
      aria-label="Session progress"
      className="flex h-full w-full flex-col overflow-hidden border-l border-line-subtle bg-surface outline-none"
    >
      <div className="flex h-12 flex-none items-center gap-2 px-3">
        <b className="text-sm">Progress</b>
        {progress.total > 0 && (
          <span className="text-xs tabular-nums text-fg-3">
            {progress.done}/{progress.total} done
          </span>
        )}
        <span className="flex-1" />
        <button
          type="button"
          aria-label="Close panel"
          title="Close"
          onClick={closePanel}
          className="grid h-8 w-8 place-items-center rounded-control text-fg-3 hover:bg-fill-2 hover:text-fg"
        >
          <X size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section
          title="Steps"
          count={todos.length}
          empty="Steps appear here while the agent works on a task."
        >
          <ol role="list" className="m-0 flex list-none flex-col gap-1.5 p-0">
            {todos.map((todo) => (
              <li key={todo.id} className="flex items-start gap-2 text-xs">
                <span className="mt-0.5 flex-none">
                  <StatusIcon status={todo.status} />
                </span>
                <span
                  className={cn(
                    "min-w-0 break-words",
                    (todo.status === "completed" || todo.status === "cancelled") &&
                      "text-fg-3 line-through",
                    todo.status === "in_progress" && "text-fg",
                  )}
                >
                  {todo.text}
                </span>
              </li>
            ))}
          </ol>
        </Section>

        <Section
          title="Outputs"
          count={outputs.length}
          empty="Files and artifacts the agent creates show up here."
        >
          {cards.length > 0 && (
            <div className="mb-1.5 grid grid-cols-2 gap-1.5">
              {cards.map((output) => (
                <OutputCard key={output.key} output={output} />
              ))}
            </div>
          )}
          {rows.length > 0 && (
            <div className="flex flex-col">
              {rows.map((output) => (
                <OutputRow key={output.key} output={output} />
              ))}
            </div>
          )}
        </Section>

        <Section
          title="Used in this session"
          count={usage.docs.length + (usage.images > 0 ? 1 : 0) + (usage.tools.length > 0 ? 1 : 0)}
          hideCount
          empty="Nothing used yet."
        >
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-xs">
            {usage.docs.map((doc) => (
              <li key={`${doc.name}:${doc.mime}`} className="flex items-center gap-2">
                <FileText size={13} className="flex-none text-fg-3" />
                <span className="min-w-0 flex-1 truncate">{doc.name}</span>
              </li>
            ))}
            {usage.images > 0 && (
              <li className="flex items-center gap-2">
                <ImageIcon size={13} className="flex-none text-fg-3" />
                <span>
                  {usage.images} {usage.images === 1 ? "image" : "images"}
                </span>
              </li>
            )}
            {usage.tools.length > 0 && (
              <li className="flex items-start gap-2">
                <Wrench size={13} className="mt-0.5 flex-none text-fg-3" />
                <span className="min-w-0 flex-1 break-words" title={toolSummary}>
                  {toolSummary}
                </span>
              </li>
            )}
            {usage.domains.length > 0 && (
              <li className="flex items-start gap-2">
                <Globe size={13} className="mt-0.5 flex-none text-fg-3" />
                <span className="flex min-w-0 flex-wrap gap-1">
                  {usage.domains.map((domain) => (
                    <span
                      key={domain}
                      className="rounded bg-fill-2 px-1.5 py-0.5 text-[11px] text-fg-3"
                    >
                      {domain}
                    </span>
                  ))}
                </span>
              </li>
            )}
          </ul>
        </Section>
      </div>
    </section>
  );
}
