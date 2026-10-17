import { useEffect, useState } from "react";
import { ArrowLeft, ArrowUp, X } from "lucide-react";
import { useApp } from "../lib/store";
import { projectInputSchema } from "../lib/types";
import { deleteKnowledgeDoc, listKnowledgeDocs, type KnowledgeDocRow } from "../lib/db";
import { knowledgeSidecarDelete } from "../lib/api";
import { MemoryEditor } from "./MemoryEditor";
import { Button, Input, Textarea } from "./ui";
import { confirmDialog } from "./ConfirmDialog";
import { errorText } from "../lib/utils";

function formatBytes(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
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
      await deleteKnowledgeDoc(doc.id);
      setDocs((prev) => prev.filter((row) => row.id !== doc.id));
      await knowledgeSidecarDelete(project.id, doc.sha256).catch(() => undefined);
    } catch (e) {
      setStatus(errorText(e));
    } finally {
      setRemovingId(null);
    }
  };

  const start = async () => {
    const text = draft.trim();
    if (!text) return;
    setDraft("");
    await startProjectChat(project.id, text);
  };

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto grid w-full max-w-[1000px] grid-cols-[minmax(0,1fr)_320px] gap-5">
        <div className="flex min-w-0 flex-col gap-3">
          <div>
            <Button variant="default" size="sm" onClick={onBack}>
              <ArrowLeft size={14} /> Back
            </Button>
          </div>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => void save()}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            aria-label="Project name"
            className="w-full rounded-control border border-transparent bg-transparent px-1.5 py-1 text-[22px] font-semibold outline-none hover:border-border focus:border-border"
          />
          {project.description && <p className="px-1.5 text-sm text-muted">{project.description}</p>}

          <div className="composer rounded-composer border border-border bg-surface-2 p-2.5">
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
              className="block w-full resize-none border-0 bg-transparent text-[15px] outline-none placeholder:text-muted"
            />
            <div className="mt-1 flex justify-end">
              <button
                type="button"
                onClick={() => void start()}
                aria-label="Start chat"
                disabled={!draft.trim()}
                className="grid h-8 w-8 place-items-center rounded-full bg-accent text-accent-contrast disabled:bg-active disabled:text-muted"
              >
                <ArrowUp size={16} />
              </button>
            </div>
          </div>

          <h3 className="mb-0 mt-2 text-sm font-semibold">Chats</h3>
          {chats.length === 0 && <p className="text-sm text-muted">No chats yet.</p>}
          {chats.map((chat) => (
            <button
              key={chat.id}
              type="button"
              onClick={() => void selectConversation(chat.id).catch(() => undefined)}
              className="block w-full rounded-card border border-border px-3 py-2.5 text-left text-sm hover:bg-hover"
            >
              {chat.title}
            </button>
          ))}
          {status && (
            <p className="text-xs text-muted" role="status">
              {status}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <div className="rounded-card border border-border bg-surface p-3">
            <b className="text-sm">Instructions</b>
            <Textarea
              rows={6}
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              aria-label="Instructions"
              placeholder="How the assistant should behave in this project"
              className="mt-2"
            />
            <div className="mt-2">
              <Button variant="primary" size="sm" onClick={() => void save()}>
                Save
              </Button>
            </div>
            <div className="mt-2">
              <label className="mb-1 block text-xs text-muted">Description</label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this project is about"
              />
            </div>
          </div>

          <div className="rounded-card border border-border bg-surface p-3">
            <b className="text-sm">Memory</b>
            <p className="mb-2 mt-1 text-xs text-muted">
              {projectMemories.length} note{projectMemories.length === 1 ? "" : "s"} · sent with
              every chat here
            </p>
            <MemoryEditor
              memories={projectMemories}
              emptyHint="No memory for this project yet."
              onAdd={(d) => addMemory({ scope: "project", project_id: project.id, ...d })}
              onUpdate={(id, d) => editMemory(id, d)}
              onDelete={(id) => deleteMemory(id)}
            />
          </div>

          <div className="rounded-card border border-border bg-surface p-3">
            <b className="text-sm">Docs</b>
            <p className="mb-2 mt-1 text-xs text-muted">
              {docs.length} file{docs.length === 1 ? "" : "s"} · searched on every send here
            </p>
            {docsError && <p className="text-sm text-muted">{docsError}</p>}
            {!docsLoaded && !docsError && <p className="text-sm text-muted">Loading…</p>}
            {docsLoaded && !docsError && docs.length === 0 && (
              <p className="text-sm text-muted">No docs yet. Attach files from the composer.</p>
            )}
            <ul className="flex flex-col gap-1.5">
              {docs.map((doc) => (
                <li
                  key={doc.id}
                  className="flex items-center gap-2 rounded-control border border-border bg-surface-2 px-2 py-1 text-xs"
                >
                  <span className="min-w-0 flex-1 truncate" title={doc.name}>
                    {doc.name}
                  </span>
                  <span className="flex-none text-muted">{formatBytes(doc.size)}</span>
                  <button
                    type="button"
                    onClick={() => void removeDoc(doc)}
                    disabled={removingId === doc.id}
                    aria-label={`Remove ${doc.name}`}
                    className="flex-none text-muted hover:text-fg disabled:text-faint"
                  >
                    <X size={12} />
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-card border border-border bg-surface p-3">
            <b className="text-sm">Context</b>
            <p className="mb-2 mt-1 text-xs text-muted">
              {capacity}% of project context used
            </p>
            <div className="h-1 overflow-hidden rounded bg-active">
              <div className="h-full bg-accent" style={{ width: `${capacity}%` }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
