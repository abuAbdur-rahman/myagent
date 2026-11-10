import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Brain, Copy, FileText, X } from "lucide-react";
import { useApp } from "../lib/store";
import { DEFAULT_MODEL_CONTEXT, promptBudget } from "../lib/context";
import { parseDocAttachments } from "../lib/attachments";
import * as api from "../lib/api";
import { copyWithToast } from "./ChatHeader";
import { errorText } from "../lib/utils";
import { Badge, Button, Pill } from "./ui";

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
    <section className="border-t border-line-subtle px-4 py-4 first:border-t-0">
      <div className="mb-2.5 flex items-baseline gap-2">
        <h3 className="m-0 text-xs font-medium text-fg-3">{title}</h3>
        {typeof tokens === "number" && (
          <span className="text-xs tabular-nums text-fg-3">≈{tokens} tok</span>
        )}
        {typeof count === "number" && (
          <span className="text-xs tabular-nums text-fg-3">{count}</span>
        )}
      </div>
      {children}
    </section>
  );
}

export function ContextInspector() {
  const {
    messages,
    streaming,
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
    modelContextLimit,
    episodicRecall,
    standingPrompt,
    chatPrompt,
    contextInfo,
    inspectContext,
    todos,
    closePanel,
  } = useApp();
  const [skills, setSkills] = useState<string[]>([]);
  const [promptOpen, setPromptOpen] = useState(false);
  const [inspection, setInspection] = useState<api.RequestInspection | null>(null);
  const [inspectionError, setInspectionError] = useState<string | null>(null);

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

  useEffect(() => {
    let live = true;
    setInspection(null);
    setInspectionError(null);
    if (streaming) return;
    const timeout = window.setTimeout(() => {
      void inspectContext()
        .then((value) => {
          if (live) setInspection(value);
        })
        .catch((error: unknown) => {
          if (live) setInspectionError(errorText(error));
        });
    }, 150);
    return () => {
      live = false;
      window.clearTimeout(timeout);
    };
  }, [inspectContext, messages, contextInfo.prompt, streaming]);

  const docs = useMemo(
    () => messages.flatMap((message) => parseDocAttachments(message.attachments)),
    [messages],
  );
  const messageChars = messages.reduce((sum, message) => sum + message.content.length, 0);

  return (
    <section
      aria-label="Context inspector"
      className="flex h-full w-full flex-col overflow-hidden bg-canvas shadow-[inset_1px_0_0_var(--line)] outline-none"
    >
      <div className="flex h-12 flex-none items-center gap-2 border-b border-line-subtle px-4">
        <Brain size={16} className="text-fg-3" />
        <b className="text-sm font-semibold">Context</b>
        <span className="flex-1" />
        <Button
          size="sm"
          variant="ghost"
          disabled={!inspection}
          onClick={() => inspection && void copyWithToast(inspection.json)}
        >
          <Copy size={12} /> Request JSON
        </Button>
        <button
          type="button"
          aria-label="Close context inspector"
          title="Close"
          onClick={closePanel}
          className="grid h-7 w-7 place-items-center rounded-field text-fg-2 hover:bg-fill-2 hover:text-fg"
        >
          <X size={16} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title="Usage">
          <div className="flex items-baseline gap-2">
            <b className="text-xl font-semibold tabular-nums">
              {contextInfo.tokens.toLocaleString()}
            </b>
            <span className="text-xs text-fg-3">
              of {contextInfo.limit.toLocaleString()} tokens
              {contextInfo.pct === null ? "" : ` · ${contextInfo.pct}%`}
            </span>
          </div>
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-fill-3"
            role="progressbar"
            aria-valuenow={contextInfo.pct ?? 0}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Context used"
          >
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${contextInfo.pct ?? 0}%` }}
            />
          </div>
          <div className="mt-2 flex items-center justify-between text-xs text-fg-3">
            <span>Last turn</span>
            <span className="tabular-nums text-fg-2">
              {contextInfo.lastIn === null
                ? "—"
                : `in ${contextInfo.lastIn.toLocaleString()} · out ${(contextInfo.lastOut ?? 0).toLocaleString()}`}
            </span>
          </div>
          {inspection && (
            <div className="mt-1 flex items-center justify-between text-xs text-fg-3">
              <span>Next request estimate</span>
              <span className="tabular-nums text-fg-2">
                ≈{inspection.total_tokens.toLocaleString()} tokens
              </span>
            </div>
          )}
        </Section>

        <Section title="Checklist" count={todos.length}>
          {todos.length === 0 ? (
            <p className="m-0 text-xs text-fg-3">No checklist for this chat.</p>
          ) : (
            <ol className="m-0 flex list-none flex-col gap-1 p-0 text-xs">
              {todos.map((todo) => (
                <li key={todo.id} className="flex items-start gap-1.5">
                  <span className="font-mono text-fg-3">
                    {todo.status === "completed" ? "[x]" : "[ ]"}
                  </span>
                  <span
                    className={
                      todo.status === "completed" || todo.status === "cancelled"
                        ? "text-fg-3 line-through"
                        : "text-fg"
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
            <dt className="text-fg-3">Project</dt>
            <dd className="m-0">{activeProject?.name ?? "None"}</dd>
            <dt className="text-fg-3">Project instructions</dt>
            <dd className="m-0">{activeProject?.instructions.trim() ? "Set" : "None"}</dd>
            <dt className="text-fg-3">Standing instructions</dt>
            <dd className="m-0">{standingPrompt.trim() ? "Set" : "None"}</dd>
            <dt className="text-fg-3">Chat instructions</dt>
            <dd className="m-0">{chatPrompt?.trim() ? "Set" : "None"}</dd>
            <dt className="text-fg-3">Memory</dt>
            <dd className="m-0">
              {globalSentMemories.length} global · {projectSentMemories.length} project
              {recalledMemories.length > 0 ? ` · ${recalledMemories.length} recalled` : ""}
            </dd>
          </dl>
        </Section>

        <Section title="System prompt" tokens={estimate(contextInfo.prompt)}>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs text-fg-3">Sent with every message</span>
            <Button size="sm" variant="ghost" onClick={() => void copyWithToast(contextInfo.prompt)}>
              <Copy size={12} /> Copy
            </Button>
          </div>
          <pre
            className={
              promptOpen
                ? "m-0 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-field bg-code p-3 font-mono text-xs leading-relaxed text-fg-2"
                : "m-0 max-h-36 overflow-hidden whitespace-pre-wrap break-words rounded-field bg-code p-3 font-mono text-xs leading-relaxed text-fg-2"
            }
          >
            {contextInfo.prompt || "No system prompt."}
          </pre>
          <Button
            size="sm"
            variant="ghost"
            className="mt-1.5"
            onClick={() => setPromptOpen((value) => !value)}
            aria-expanded={promptOpen}
          >
            {promptOpen ? "Show less" : "Show full prompt"}
          </Button>
        </Section>

        <Section
          title="Memory"
          tokens={estimate(globalSentMemories.concat(projectSentMemories).map((m) => m.content).join("\n"))}
          count={globalSentMemories.length + projectSentMemories.length}
        >
          {memoryPaused ? (
            <p className="m-0 text-xs text-warning">
              Memory is paused. No notes are sent with this turn.
            </p>
          ) : globalSentMemories.length + projectSentMemories.length === 0 ? (
            <p className="m-0 text-xs text-fg-3">No memory is sent this turn.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs">
              {[...globalSentMemories, ...projectSentMemories].map((memory) => (
                <li key={memory.id} className="flex min-w-0 items-start gap-1.5">
                  <Pill
                    tone={memory.scope === "global" ? "accent" : "info"}
                    className="h-[18px] px-1.5 text-[11px]"
                  >
                    {memory.scope === "global" ? "Global" : "Project"}
                  </Pill>
                  <span className="min-w-0 truncate text-fg-2" title={memory.content}>
                    {memory.content}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {pendingMemories.length > 0 && (
            <p className="mt-2 text-xs text-warning">
              {pendingMemories.length} waiting for review.
            </p>
          )}
        </Section>

        <Section
          title="Ranked for this turn"
          tokens={estimate(recalledMemories.map((m) => m.content).join("\n"))}
          count={recalledMemories.length}
        >
          {recalledMemories.length === 0 ? (
            <p className="m-0 text-xs text-fg-3">
              {memoryPaused
                ? "Memory is paused, so nothing was ranked."
                : "No note cleared the relevance floor, or the ones that matched were already sent in full."}
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs">
              {recalledMemories.map((memory) => {
                const score = recalledDetails.find((detail) => detail.id === memory.id)?.score;
                return (
                  <li key={memory.id} className="flex min-w-0 items-start gap-1.5">
                    <Pill
                      tone={memory.scope === "global" ? "accent" : "info"}
                      className="h-[18px] px-1.5 text-[11px]"
                    >
                      {memory.scope === "global" ? "Global" : "Project"}
                    </Pill>
                    <span className="min-w-0 flex-1 truncate text-fg-2" title={memory.content}>
                      {memory.content}
                    </span>
                    <span className="flex-none tabular-nums text-fg-3">
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
            <p className="m-0 text-xs text-fg-3">
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
                  <span className="min-w-0 flex-1 truncate text-fg-3">
                    {hit.name}
                    {hit.heading ? ` · ${hit.heading}` : ""} · #{hit.ord + 1}
                  </span>
                  <span className="flex-none tabular-nums text-fg-3">
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
            <p className="m-0 text-xs text-fg-3">
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
                  <span className="flex-none text-fg-3">{hit.date}</span>
                  <span className="min-w-0 flex-1 truncate text-fg-3">{hit.title}</span>
                  <span className="flex-none tabular-nums text-fg-3">
                    {hit.score.toFixed(3)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {memoryOmitted > 0 && (
          <Section title="Dropped">
            <p className="m-0 text-xs text-warning">
              {memoryOmitted} note{memoryOmitted === 1 ? " was" : "s were"} not selected by
              relevance or the 2,500-character send budget.
            </p>
          </Section>
        )}

        <Section title="Budget">
          <p className="m-0 flex flex-wrap items-baseline gap-x-1.5 text-xs text-fg-3">
            <span className="tabular-nums text-fg">
              {promptBudget(modelContextLimit ?? DEFAULT_MODEL_CONTEXT).total.toLocaleString()}
            </span>
            <span>characters for memory and knowledge</span>
            <span className="text-fg-3">·</span>
            <span className="tabular-nums">
              ×{promptBudget(modelContextLimit ?? DEFAULT_MODEL_CONTEXT).factor}
            </span>
            <span>
              at {Math.round((modelContextLimit ?? DEFAULT_MODEL_CONTEXT) / 1000)}k tokens
            </span>
          </p>
        </Section>

        <Section title="Project">
          <p className="m-0 text-xs text-fg-3">
            {activeProject ? activeProject.name : "No project attached."}
          </p>
        </Section>

        <Section
          title="Messages"
          tokens={inspection?.message_tokens ?? Math.ceil(messageChars / 4)}
        >
          <p className="m-0 text-xs text-fg-3">
            {messages.length} message{messages.length === 1 ? "" : "s"} in this chat. Full history is
            sent unless the chat is compacted.
          </p>
        </Section>

        <Section
          title="Tool definitions"
          tokens={inspection?.tools.reduce((sum, tool) => sum + tool.tokens, 0)}
          count={inspection?.tools.length ?? 0}
        >
          {inspectionError ? (
            <p className="m-0 text-xs text-warning">{inspectionError}</p>
          ) : !inspection ? (
            <p className="m-0 text-xs text-fg-3">Inspecting the next request…</p>
          ) : inspection.tools.length === 0 ? (
            <p className="m-0 text-xs text-fg-3">Tools are off for the next request.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs">
              {inspection.tools.map((tool) => (
                <li key={tool.name} className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-fg-2">{tool.name}</span>
                  <span className="flex-none tabular-nums text-fg-3">≈{tool.tokens} tok</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Attachments" count={docs.length}>
          {docs.length === 0 ? (
            <p className="m-0 text-xs text-fg-3">No documents attached.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-xs text-fg-3">
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
            <p className="m-0 text-xs text-fg-3">No skills indexed.</p>
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
