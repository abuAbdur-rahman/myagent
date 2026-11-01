import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Brain, Copy, FileText, X } from "lucide-react";
import { useApp } from "../lib/store";
import { buildSystemPrompt } from "../lib/context";
import { parseDocAttachments } from "../lib/attachments";
import * as api from "../lib/api";
import { copyWithToast } from "./ChatHeader";
import { Badge, Button } from "./ui";

function estimate(text: string): number {
  return Math.ceil(text.length / 4);
}

function Section({
  title,
  tokens,
  children,
}: {
  title: string;
  tokens?: number;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-border px-3.5 py-3 last:border-b-0">
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="m-0 text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</h3>
        {typeof tokens === "number" && (
          <span className="text-[11px] tabular-nums text-muted">≈{tokens} tok</span>
        )}
      </div>
      {children}
    </section>
  );
}

export function ContextInspector() {
  const {
    messages,
    activeProject,
    globalMemories,
    projectMemories,
    displayName,
    standingPrompt,
    chatPrompt,
    contextInfo,
    todos,
    closePanel,
  } = useApp();
  const [skills, setSkills] = useState<string[]>([]);

  useEffect(() => {
    let live = true;
    api
      .skillIndex()
      .then((items) => {
        if (live) setSkills(items.map((item) => item.name));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);

  const system = useMemo(
    () =>
      buildSystemPrompt({
        globalMemories,
        project: activeProject,
        projectMemories,
        userName: displayName || undefined,
        standingPrompt: standingPrompt || undefined,
        chatPrompt: chatPrompt ?? undefined,
      }) ?? "",
    [globalMemories, activeProject, projectMemories, displayName, standingPrompt, chatPrompt],
  );

  const docs = useMemo(
    () => messages.flatMap((message) => parseDocAttachments(message.attachments)),
    [messages],
  );
  const messageChars = messages.reduce((sum, message) => sum + message.content.length, 0);

  return (
    <section
      aria-label="Context inspector"
      className="flex h-full w-full flex-col overflow-hidden border-l border-border bg-surface outline-none"
    >
      <div className="flex h-12 flex-none items-center gap-2 px-3">
        <Brain size={16} className="text-muted" />
        <b className="text-sm">Context</b>
        <span className="flex-1" />
        <button
          type="button"
          aria-label="Close context inspector"
          title="Close"
          onClick={closePanel}
          className="grid h-8 w-8 place-items-center rounded-control text-muted hover:bg-hover hover:text-text"
        >
          <X size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="Usage">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div>
              <div className="text-muted">Tokens</div>
              <div className="tabular-nums">{contextInfo.tokens.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-muted">Limit</div>
              <div className="tabular-nums">{contextInfo.limit.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-muted">Used</div>
              <div className="tabular-nums">
                {contextInfo.pct === null ? "unknown" : `${contextInfo.pct}%`}
              </div>
            </div>
            <div>
              <div className="text-muted">Last turn</div>
              <div className="tabular-nums">
                {contextInfo.lastIn === null
                  ? "—"
                  : `↑${contextInfo.lastIn.toLocaleString()} ↓${(contextInfo.lastOut ?? 0).toLocaleString()}`}
              </div>
            </div>
          </div>
        </Section>

        <Section title="Checklist" tokens={todos.length}>
          {todos.length === 0 ? (
            <p className="m-0 text-xs text-muted">No checklist for this chat.</p>
          ) : (
            <ol className="m-0 flex list-none flex-col gap-1 p-0 text-xs">
              {todos.map((todo) => (
                <li key={todo.id} className="flex items-start gap-1.5">
                  <span className="font-mono text-muted">
                    {todo.status === "completed" ? "[x]" : "[ ]"}
                  </span>
                  <span
                    className={
                      todo.status === "completed" || todo.status === "cancelled"
                        ? "text-muted line-through"
                        : "text-text"
                    }
                  >
                    {todo.text}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Section>

        <Section title="Important context">
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
            <dt className="text-muted">Project</dt>
            <dd className="m-0">{activeProject?.name ?? "None"}</dd>
            <dt className="text-muted">Project instructions</dt>
            <dd className="m-0">{activeProject?.instructions.trim() ? "Set" : "None"}</dd>
            <dt className="text-muted">Standing instructions</dt>
            <dd className="m-0">{standingPrompt.trim() ? "Set" : "None"}</dd>
            <dt className="text-muted">Chat instructions</dt>
            <dd className="m-0">{chatPrompt?.trim() ? "Set" : "None"}</dd>
            <dt className="text-muted">Memory</dt>
            <dd className="m-0">
              {globalMemories.length} global · {projectMemories.length} project
            </dd>
          </dl>
        </Section>

        <Section title="System prompt" tokens={estimate(system)}>
          <div className="mb-2 flex justify-end">
            <Button size="sm" variant="ghost" onClick={() => void copyWithToast(system)}>
              <Copy size={12} /> Copy
            </Button>
          </div>
          <pre className="m-0 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-control bg-surface-2 p-2 font-mono text-[11px] text-muted">
            {system || "No system prompt."}
          </pre>
        </Section>

        <Section title="Memory" tokens={estimate(globalMemories.concat(projectMemories).map((m) => m.content).join("\n"))}>
          <div className="flex flex-wrap gap-1 text-xs text-muted">
            <Badge>{globalMemories.length} global</Badge>
            <Badge>{projectMemories.length} project</Badge>
          </div>
        </Section>

        <Section title="Project">
          <p className="m-0 text-xs text-muted">
            {activeProject ? activeProject.name : "No project attached."}
          </p>
        </Section>

        <Section title="Messages" tokens={Math.ceil(messageChars / 4)}>
          <p className="m-0 text-xs text-muted">
            {messages.length} message{messages.length === 1 ? "" : "s"} in this chat. Full history is
            sent unless the chat is compacted.
          </p>
        </Section>

        <Section title="Attachments" tokens={docs.length}>
          {docs.length === 0 ? (
            <p className="m-0 text-xs text-muted">No documents attached.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs text-muted">
              {docs.map((doc) => (
                <li key={`${doc.name}-${doc.sha256}`} className="flex items-center gap-1.5">
                  <FileText size={12} />
                  <span className="truncate">{doc.name}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Skills" tokens={skills.length}>
          {skills.length === 0 ? (
            <p className="m-0 text-xs text-muted">No skills indexed.</p>
          ) : (
            <div className="flex flex-wrap gap-1">
              {skills.map((name) => (
                <Badge key={name}>{name}</Badge>
              ))}
            </div>
          )}
        </Section>
      </div>
    </section>
  );
}
