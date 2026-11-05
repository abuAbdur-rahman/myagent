import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Brain, Copy, FileText, X } from "lucide-react";
import { useApp } from "../lib/store";
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
  count,
  children,
}: {
  title: string;
  tokens?: number;
  count?: number;
  children: ReactNode;
}) {
  return (
    <section className="border-b border-border px-3.5 py-3 last:border-b-0">
      <div className="mb-2 flex items-baseline gap-2">
        <h3 className="m-0 text-[11px] font-semibold uppercase tracking-wider text-muted">{title}</h3>
        {typeof tokens === "number" && (
          <span className="text-[11px] tabular-nums text-muted">≈{tokens} tok</span>
        )}
        {typeof count === "number" && (
          <span className="text-[11px] tabular-nums text-muted">{count}</span>
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
    globalSentMemories,
    projectSentMemories,
    recalledMemories,
    recalledDetails,
    knowledgeSummary,
    episodeSummary,
    pendingMemories,
    memoryPaused,
    memoryOmitted,
    episodicRecall,
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

        <Section title="Checklist" count={todos.length}>
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
              {globalSentMemories.length} global · {projectSentMemories.length} project
              {recalledMemories.length > 0 ? ` · ${recalledMemories.length} recalled` : ""}
            </dd>
          </dl>
        </Section>

        <Section title="System prompt" tokens={estimate(contextInfo.prompt)}>
          <div className="mb-2 flex justify-end">
            <Button size="sm" variant="ghost" onClick={() => void copyWithToast(contextInfo.prompt)}>
              <Copy size={12} /> Copy
            </Button>
          </div>
          <pre className="m-0 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-control bg-surface-2 p-2 font-mono text-[11px] text-muted">
            {contextInfo.prompt || "No system prompt."}
          </pre>
        </Section>

        <Section
          title="Memory"
          tokens={estimate(globalSentMemories.concat(projectSentMemories).map((m) => m.content).join("\n"))}
          count={globalSentMemories.length + projectSentMemories.length}
        >
          {memoryPaused ? (
            <p className="m-0 text-xs text-warn">
              Memory is paused. No notes are sent with this turn.
            </p>
          ) : globalSentMemories.length + projectSentMemories.length === 0 ? (
            <p className="m-0 text-xs text-muted">No memory is sent this turn.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs">
              {[...globalSentMemories, ...projectSentMemories].map((memory) => (
                <li key={memory.id} className="flex min-w-0 gap-1.5">
                  <span className="flex-none text-muted">
                    {memory.scope === "global" ? "G" : "P"}
                  </span>
                  <span className="min-w-0 truncate text-muted" title={memory.content}>
                    {memory.content}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {pendingMemories.length > 0 && (
            <p className="mt-2 text-xs text-warn">
              {pendingMemories.length} waiting for review.
            </p>
          )}
        </Section>

        <Section
          title="Recalled for this turn"
          tokens={estimate(recalledMemories.map((m) => m.content).join("\n"))}
          count={recalledMemories.length}
        >
          {recalledMemories.length === 0 ? (
            <p className="m-0 text-xs text-muted">
              {memoryPaused
                ? "Memory is paused, so nothing was ranked."
                : "No note cleared the relevance floor for this message."}
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs">
              {recalledMemories.map((memory) => {
                const score = recalledDetails.find((detail) => detail.id === memory.id)?.score;
                return (
                  <li key={memory.id} className="flex min-w-0 gap-1.5">
                    <span className="flex-none text-muted">
                      {memory.scope === "global" ? "G" : "P"}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-muted" title={memory.content}>
                      {memory.content}
                    </span>
                    <span className="flex-none tabular-nums text-text-faint">
                      {score === undefined ? "" : score.toFixed(3)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section
          title="Project knowledge"
          tokens={estimate(
            knowledgeSummary.map((hit) => hit.text).join("\n"),
          )}
          count={knowledgeSummary.length}
        >
          {knowledgeSummary.length === 0 ? (
            <p className="m-0 text-xs text-muted">
              {activeProject
                ? "No document chunk matched this message."
                : "Knowledge is project-scoped; this chat has no project."}
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs">
              {knowledgeSummary.map((hit) => (
                <li
                  key={`${hit.doc_id}:${hit.ord}`}
                  className="flex min-w-0 gap-1.5"
                  title={hit.text}
                >
                  <span className="min-w-0 flex-1 truncate text-muted">
                    {hit.name}
                    {hit.heading ? ` · ${hit.heading}` : ""} · #{hit.ord + 1}
                  </span>
                  <span className="flex-none tabular-nums text-text-faint">
                    {hit.score.toFixed(3)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section
          title="Earlier conversations"
          tokens={estimate(
            episodeSummary.map((hit) => hit.snippet).join("\n"),
          )}
          count={episodeSummary.length}
        >
          {episodeSummary.length === 0 ? (
            <p className="m-0 text-xs text-muted">
              {!activeProject
                ? "Past-chat recall runs in project chats only."
                : episodicRecall
                  ? "No earlier chat matched strongly enough."
                  : "Past-chat recall is switched off in Settings."}
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs">
              {episodeSummary.map((hit) => (
                <li key={hit.message_id} className="flex min-w-0 gap-1.5" title={hit.snippet}>
                  <span className="flex-none text-muted">{hit.date}</span>
                  <span className="min-w-0 flex-1 truncate text-muted">{hit.title}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {memoryOmitted > 0 && (
          <Section title="Dropped">
            <p className="m-0 text-xs text-warn">
              {memoryOmitted} global note{memoryOmitted === 1 ? "" : "s"} over the 2,500-character
              send budget. Shorten or merge them in Settings → Memory.
            </p>
          </Section>
        )}

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

        <Section title="Attachments" count={docs.length}>
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

        <Section title="Skills" count={skills.length}>
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
