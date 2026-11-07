import { useEffect, useState } from "react";
import { ArrowLeft, ArrowUp, ChevronRight, X } from "lucide-react";
import { useApp } from "../lib/store";
import { projectInputSchema, type Conversation } from "../lib/types";
import * as api from "../lib/api";
import { deleteKnowledgeDoc, listKnowledgeDocs, type KnowledgeDocRow } from "../lib/db";
import { MemoryEditor } from "./MemoryEditor";
import { PendingMemoryBar } from "./PendingMemoryBar";
import { Button, Input, Pill, Textarea } from "./ui";
import { confirmDialog } from "./ConfirmDialog";
import { errorText } from "../lib/utils";

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function relativeTime(value: number): string {
  const diff = Date.now() - value;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function ProjectChats({ chats, onSelect }: { chats: Conversation[]; onSelect: (id: string) => void }) {
  if (chats.length === 0) {
    return <p className="px-1 py-4 text-sm text-fg-3">No chats yet.</p>;
  }
  return (
    <div className="flex flex-col">
      {chats.map((chat) => (
        <button
          key={chat.id}
          type="button"
          onClick={() => onSelect(chat.id)}
          className="flex items-center gap-3 border-t border-line-subtle px-1 py-3 text-left first:border-t-0 hover:bg-fill-2"
        >
          <span className="min-w-0 flex-1">
            <b className="block truncate text-sm font-medium">{chat.title}</b>
            <small className="text-xs text-fg-3">{relativeTime(chat.updated_at)}</small>
          </span>
          <ChevronRight size={15} className="flex-none text-fg-3" />
        </button>
      ))}
    </div>
  );
}

function DocsPanel({
  docs,
  loaded,
  error,
  removingId,
  rebuilding,
  onRebuild,
  onRemove,
}: {
  docs: KnowledgeDocRow[];
  loaded: boolean;
  error: string | null;
  removingId: string | null;
  rebuilding: boolean;
  onRebuild: () => void;
  onRemove: (doc: KnowledgeDocRow) => void;
}) {
  return (
    <section className="border-t border-line-subtle p-4">
      <div className="flex items-baseline justify-between gap-2">
        <b className="text-sm font-semibold">Docs</b>
        <button
          type="button"
          onClick={onRebuild}
          disabled={rebuilding || docs.length === 0}
          className="text-xs text-accent-text hover:underline disabled:text-text-off disabled:no-underline"
        >
          {rebuilding ? "Reindexing…" : "Reindex"}
        </button>
      </div>
      <p className="mb-2 mt-1 text-xs text-fg-3">
        {docs.length} file{docs.length === 1 ? "" : "s"} · searched on every send here
      </p>
      {error && <p className="text-sm text-fg-3">{error}</p>}
      {!loaded && !error && <p className="text-sm text-fg-3">Loading…</p>}
      {loaded && !error && docs.length === 0 && (
        <p className="text-sm text-fg-3">No docs yet. Attach files from the composer.</p>
      )}
      <ul className="flex flex-col">
        {docs.map((doc) => (
          <li
            key={doc.id}
            className="flex items-center gap-2 border-t border-line-subtle py-2 text-xs first:border-t-0"
          >
            <span className="min-w-0 flex-1 truncate text-fg-2" title={doc.name}>
              {doc.name}
            </span>
            <span className="flex-none text-fg-3">{formatBytes(doc.size)}</span>
            <button
              type="button"
              onClick={() => onRemove(doc)}
              disabled={removingId === doc.id}
              aria-label={`Remove ${doc.name}`}
              className="flex-none text-fg-3 hover:text-danger disabled:text-text-off"
            >
              <X size={12} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ContextPanel({ capacity }: { capacity: number }) {
  return (
    <section className="border-t border-line-subtle p-4">
      <b className="text-sm font-semibold">Context</b>
      <p className="mb-2 mt-1 text-xs text-fg-3">{capacity}% of project context used</p>
      <div className="h-1.5 overflow-hidden rounded-full bg-fill-3">
        <div className="h-full rounded-full bg-accent" style={{ width: `${capacity}%` }} />
      </div>
    </section>
  );
}

export function ProjectDetail({ onBack }: { onBack: () => void }) {
  const {
    activeProject,
    conversations,
    selectConversation,
    saveProject,
    startProjectChat,
    projectMemories,
    addMemory,
    editMemory,
    deleteMemory,
  } = useApp();

  const [name, setName] = useState(activeProject?.name ?? "");
  const [description, setDescription] = useState(activeProject?.description ?? "");
  const [instructions, setInstructions] = useState(activeProject?.instructions ?? "");
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [docs, setDocs] = useState<KnowledgeDocRow[]>([]);
  const [docsLoaded, setDocsLoaded] = useState(false);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [rebuilding, setRebuilding] = useState(false);

  useEffect(() => {
    setName(activeProject?.name ?? "");
    setDescription(activeProject?.description ?? "");
    setInstructions(activeProject?.instructions ?? "");
    setStatus(null);
  }, [activeProject?.id, activeProject?.name, activeProject?.description, activeProject?.instructions]);

  useEffect(() => {
    const id = activeProject?.id;
    setDocs([]);
    setDocsError(null);
    setDocsLoaded(false);
    if (!id) return;
    let live = true;
    listKnowledgeDocs(id)
      .then((rows) => {
        if (live) {
          setDocs(rows);
          setDocsLoaded(true);
        }
      })
      .catch((e) => {
        if (live) {
          setDocsError(errorText(e));
          setDocsLoaded(true);
        }
      });
    return () => {
      live = false;
    };
  }, [activeProject?.id]);

  if (!activeProject) {
    return (
      <div className="grid h-full place-items-center">
        <p className="text-sm text-muted">Select a project.</p>
      </div>
    );
  }

  const project = activeProject;
  const chats = conversations.filter((c) => c.project_id === project.id);
  const contextChars =
    project.description.length +
    project.instructions.length +
    projectMemories.reduce((sum, m) => sum + m.content.length, 0);
  const capacity = Math.min(100, Math.round((contextChars / 6000) * 100));

  const save = async () => {
    const parsed = projectInputSchema.safeParse({
      name: name.trim(),
      description: description.trim(),
      instructions: instructions.trim(),
    });
    if (!parsed.success) {
      setStatus(parsed.error.issues[0]?.message ?? "Invalid project");
      return;
    }
    try {
      await saveProject(parsed.data, project.id);
      setStatus("Saved.");
    } catch (e) {
      setStatus(errorText(e));
    }
  };

  const removeDoc = async (doc: KnowledgeDocRow) => {
    const confirmed = await confirmDialog({
      title: `Remove ${doc.name}?`,
      body: "The file will be removed from this project's knowledge.",
      danger: true,
      ok: "Remove",
    });
    if (!confirmed) return;
    setRemovingId(doc.id);
    try {
      await deleteKnowledgeDoc(doc.id, project.id, doc.sha256);
      await api.knowledgePurgeDoc(doc.id).catch((e: unknown) => console.warn(
        "knowledge: chunk cleanup failed",
        e,
      ));
      setDocs((prev) => prev.filter((row) => row.id !== doc.id));
    } catch (e) {
      setStatus(errorText(e));
    } finally {
      setRemovingId(null);
    }
  };

  const reindexDocs = async () => {
    setRebuilding(true);
    try {
      const report: api.KnowledgeFillReport = await api.knowledgeReindex(project.id);
      if (report.errors.length > 0) {
        setStatus(
          `Indexed ${report.chunks} chunks, but ${report.errors.length} could not be indexed: ${report.errors[0]}`,
        );
      } else {
        setStatus(
          `Indexed ${report.chunks} chunks from ${report.documents} document${
            report.documents === 1 ? "" : "s"
          }.`,
        );
      }
    } catch (e) {
      setStatus(errorText(e));
    } finally {
      setRebuilding(false);
    }
  };

  const start = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    await startProjectChat(project.id, text);
  };

  const dirty =
    name !== project.name ||
    description !== project.description ||
    instructions !== project.instructions;

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 flex-none items-center gap-1 border-b border-line-subtle px-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft size={14} /> Projects
        </Button>
        <span className="text-text-off" aria-hidden="true">
          /
        </span>
        <b className="min-w-0 truncate text-sm font-medium">{project.name}</b>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-[1040px] grid-cols-[minmax(0,1fr)_340px] gap-10 px-8 pb-12 pt-4">
          <div className="flex min-w-0 flex-col">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => void save()}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              aria-label="Project name"
              className="w-full rounded-field bg-transparent px-1 py-1 font-serif text-[1.75rem] font-normal leading-tight outline-none hover:bg-fill-1 focus:bg-fill-1"
            />
            <p className="mb-0 mt-1 px-1 text-sm text-fg-3">
              {project.description || "Add a description to explain what this project is for."}
            </p>

            <div className="composer mt-6 rounded-composer bg-raised p-2.5 shadow-[inset_0_0_0_1px_var(--line),var(--shadow-sm)]">
              <textarea
                rows={2}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void start();
                  }
                }}
                aria-label="New chat in project"
                placeholder="Start a new chat in this project…"
                className="block w-full resize-none border-0 bg-transparent px-1 text-[15px] leading-relaxed outline-none placeholder:text-fg-3"
              />
              <div className="mt-1 flex justify-end">
                <button
                  type="button"
                  onClick={() => void start()}
                  aria-label="Start chat"
                  disabled={!draft.trim()}
                  className="grid h-8 w-8 place-items-center rounded-[10px] bg-accent text-accent-contrast disabled:bg-fill-2 disabled:text-text-off"
                >
                  <ArrowUp size={16} />
                </button>
              </div>
            </div>

            <div className="mb-1 mt-7 flex items-center gap-2 text-xs font-medium text-fg-3">
              <span>Chats</span>
              <Pill>{chats.length}</Pill>
            </div>
            <ProjectChats
              chats={chats}
              onSelect={(id) => void selectConversation(id).catch(() => undefined)}
            />
            {status && (
              <p className="text-xs text-fg-3" role="status">
                {status}
              </p>
            )}
          </div>

          <div className="self-start rounded-card bg-raised shadow-[inset_0_0_0_1px_var(--line)]">
            <section className="p-4">
              <h2 className="mb-2 flex items-center justify-between text-sm font-semibold">
                Instructions
              </h2>
              <Textarea
                rows={5}
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                aria-label="Instructions"
                placeholder="How the assistant should behave in this project"
              />
              <div className="mt-2 flex justify-end">
                <Button variant="primary" size="sm" onClick={() => void save()} disabled={!dirty}>
                  Save
                </Button>
              </div>
            </section>

            <section className="border-t border-line-subtle p-4">
              <h2 className="mb-2 text-sm font-semibold">Description</h2>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this project is about"
                aria-label="Project description"
              />
            </section>

            <section className="border-t border-line-subtle p-4">
              <h2 className="mb-1 flex items-center justify-between text-sm font-semibold">
                Memory
              </h2>
              <p className="mb-2 text-xs text-fg-3">
                {projectMemories.filter((memory) => !memory.untrusted).length} note
                {projectMemories.filter((memory) => !memory.untrusted).length === 1 ? "" : "s"} ·
                sent with every chat here
              </p>
              <PendingMemoryBar projectId={project.id} />
              <MemoryEditor
                memories={projectMemories}
                emptyHint="No memory for this project yet."
                onAdd={(d) => addMemory({ scope: "project", project_id: project.id, ...d })}
                onUpdate={(id, d) => editMemory(id, d, "project", project.id)}
                onDelete={(id) => deleteMemory(id, "project", project.id)}
              />
            </section>

            <DocsPanel
              docs={docs}
              loaded={docsLoaded}
              error={docsError}
              removingId={removingId}
              rebuilding={rebuilding}
              onRebuild={() => void reindexDocs()}
              onRemove={(doc) => void removeDoc(doc)}
            />

            <ContextPanel capacity={capacity} />
          </div>
        </div>
      </div>
    </div>
  );
}
