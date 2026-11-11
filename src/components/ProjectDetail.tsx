import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ArrowLeft, ArrowUp, ChevronRight, FileText, Mic, Paperclip, X } from "lucide-react";
import { useApp } from "../lib/store";
import { projectInputSchema, type Conversation } from "../lib/types";
import * as api from "../lib/api";
import { deleteKnowledgeDoc, listKnowledgeDocs, type KnowledgeDocRow } from "../lib/db";
import { MemoryEditor } from "./MemoryEditor";
import { PendingMemoryBar } from "./PendingMemoryBar";
import { Button, Input, Textarea } from "./ui";
import { confirmDialog } from "./ConfirmDialog";
import { cn, errorText } from "../lib/utils";
import { MAX_DOCS_PER_TURN, releaseChatDoc } from "../lib/chat-docs";
import { toast } from "../lib/toast";
import { useVoiceInput } from "./composer/useVoiceInput";
import {
  collectChips,
  docChipsIn,
  docsOf,
  imagesOf,
  isDocChip,
  isDocFile,
  outgoingText,
  type AttachChip,
} from "./composer/attachments";

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
    return <p className="px-1 py-6 text-sm text-fg-3">No chats yet.</p>;
  }
  return (
    <div className="flex flex-col">
      {chats.map((chat) => (
        <button
          key={chat.id}
          type="button"
          onClick={() => onSelect(chat.id)}
          className="flex items-center gap-3 rounded-field px-2 py-3 text-left transition-colors hover:bg-fill-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-line focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          <span className="min-w-0 flex-1">
            <b className="block truncate text-sm font-medium">{chat.title}</b>
            <small className="text-xs text-fg-3">{relativeTime(chat.updated_at)}</small>
          </span>
          <ChevronRight size={15} className="flex-none text-fg-3" aria-hidden="true" />
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
    <section>
      <div className="flex items-baseline justify-between gap-2">
        <p className="mb-0 text-xs text-fg-3">
          {docs.length} file{docs.length === 1 ? "" : "s"} · searched on every send here
        </p>
        <button
          type="button"
          onClick={onRebuild}
          disabled={rebuilding || docs.length === 0}
          className="rounded-chip text-xs text-accent-text hover:underline disabled:text-text-off disabled:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-line focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
        >
          {rebuilding ? "Reindexing…" : "Reindex"}
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-fg-3">{error}</p>}
      {!loaded && !error && <p className="mt-2 text-sm text-fg-3">Loading…</p>}
      {loaded && !error && docs.length === 0 && (
        <p className="mt-2 text-sm text-fg-3">No docs yet. Attach files from the composer.</p>
      )}
      <ul className="mt-3 grid gap-2">
        {docs.map((doc) => (
          <li
            key={doc.id}
            className="flex items-center gap-2.5 rounded-field bg-fill-1 p-2 text-xs shadow-[inset_0_0_0_1px_var(--line-subtle)]"
          >
            <span className="grid h-8 w-8 flex-none place-items-center rounded-field bg-fill-2 text-fg-3">
              <FileText size={16} aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1" title={doc.name}>
              <span className="block truncate font-medium text-fg-2">{doc.name}</span>
              <span className="text-fg-3">{formatBytes(doc.size)}</span>
            </span>
            <span className="flex-none rounded-chip bg-fill-2 px-1.5 py-0.5 text-xs font-medium text-fg-3">
              TEXT
            </span>
            <button
              type="button"
              onClick={() => onRemove(doc)}
              disabled={removingId === doc.id}
              aria-label={`Remove ${doc.name}`}
              className="flex-none rounded-chip text-fg-3 hover:text-danger disabled:text-text-off focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-line focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
            >
              <X size={12} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

type Tab = "instructions" | "memory" | "docs";

const TABS: { id: Tab; label: string }[] = [
  { id: "instructions", label: "Instructions" },
  { id: "memory", label: "Memory" },
  { id: "docs", label: "Docs" },
];

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
    streaming,
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
  const [tab, setTab] = useState<Tab>("instructions");
  const [chips, setChips] = useState<AttachChip[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [startingChat, setStartingChat] = useState(false);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const attachingRef = useRef(false);
  const startingChatRef = useRef(false);
  const chipsRef = useRef(chips);
  chipsRef.current = chips;
  const voice = useVoiceInput((text) => {
    setDraft((current) => `${current}${current.trim() ? " " : ""}${text}`);
  }, streaming || attaching || startingChat);

  useEffect(() => {
    setName(activeProject?.name ?? "");
    setDescription(activeProject?.description ?? "");
    setInstructions(activeProject?.instructions ?? "");
    setStatus(null);
  }, [activeProject?.id, activeProject?.name, activeProject?.description, activeProject?.instructions]);

  useEffect(() => {
    setDraft("");
    setChips([]);
    setTab("instructions");
    return () => {
      for (const doc of docsOf(chipsRef.current)) void releaseChatDoc(doc, []);
    };
  }, [activeProject?.id]);

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
  const notes = projectMemories.filter((memory) => !memory.untrusted);
  const contextChars =
    project.description.length +
    project.instructions.length +
    projectMemories.reduce((sum, m) => sum + m.content.length, 0);
  const capacity = Math.min(100, Math.round((contextChars / 6000) * 100));
  const contextTone =
    capacity >= 90 ? "bg-danger" : capacity >= 70 ? "bg-warning" : "bg-accent";
  const counts: Record<Tab, number | null> = {
    instructions: null,
    memory: notes.length,
    docs: docs.length,
  };

  const selectTab = (next: Tab) => {
    setTab(next);
    tabRefs.current[next]?.focus();
  };

  const onTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    const step =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (event.key === "Home") {
      event.preventDefault();
      selectTab(TABS[0].id);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      selectTab(TABS[TABS.length - 1].id);
      return;
    }
    if (!step) return;
    event.preventDefault();
    selectTab(TABS[(index + step + TABS.length) % TABS.length].id);
  };

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

  const attachFiles = async (files: File[]) => {
    if (files.length === 0 || attachingRef.current || startingChatRef.current) return;
    attachingRef.current = true;
    setAttaching(true);
    try {
      const room = MAX_DOCS_PER_TURN - docChipsIn(chipsRef.current);
      const added = await collectChips(files, null, room);
      setChips((current) => [...current, ...added]);
      if (files.filter(isDocFile).length > room) {
        toast(`Up to ${MAX_DOCS_PER_TURN} documents per message.`);
      }
    } finally {
      attachingRef.current = false;
      setAttaching(false);
    }
  };

  const removeChip = (key: string) => {
    const chip = chipsRef.current.find((item) => item.key === key);
    const remaining = chipsRef.current.filter((item) => item.key !== key);
    setChips(remaining);
    if (chip && isDocChip(chip)) void releaseChatDoc(chip.doc, docsOf(remaining));
  };

  const start = async () => {
    if (startingChatRef.current || attachingRef.current) return;
    const attachedImages = imagesOf(chipsRef.current);
    const attachedDocs = docsOf(chipsRef.current);
    const text = outgoingText(draft, attachedImages.length, attachedDocs.length);
    if (!text) return;
    startingChatRef.current = true;
    setStartingChat(true);
    try {
      const accepted = await startProjectChat(project.id, text, attachedImages, attachedDocs);
      if (!accepted) return;
      setDraft("");
      setChips([]);
    } finally {
      startingChatRef.current = false;
      setStartingChat(false);
    }
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
        <span className="ml-auto flex-none text-xs text-fg-3">
          {chats.length} chat{chats.length === 1 ? "" : "s"}
        </span>
      </div>

      <div className="@container min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-[1180px] grid-cols-1 gap-8 px-8 pb-16 pt-8 @[960px]:grid-cols-[minmax(0,1fr)_348px]">
          <main className="flex min-w-0 flex-col">
            <div className="min-w-0">
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => void save()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                }}
                aria-label="Project name"
                className="w-full rounded-field bg-transparent px-1 py-1 font-serif text-[1.75rem] font-normal leading-tight outline-none hover:bg-fill-1 focus:bg-fill-1 focus-visible:ring-2 focus-visible:ring-accent-line"
              />
              <p className="mb-0 mt-1 line-clamp-2 px-1 text-sm text-fg-3">
                {project.description || "Add a description to explain what this project is for."}
              </p>
            </div>

            <div
              className="composer mt-6 rounded-composer bg-raised p-2.5 shadow-[inset_0_0_0_1px_var(--line),var(--shadow-sm)]"
              aria-busy={attaching || startingChat}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                void attachFiles([...event.dataTransfer.files]);
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                className="hidden"
                onChange={(event) => {
                  void attachFiles([...(event.target.files ?? [])]);
                  event.target.value = "";
                }}
              />
              {chips.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {chips.map((chip) => (
                    <span
                      key={chip.key}
                      className="flex max-w-[240px] items-center gap-1 rounded-chip bg-fill-2 px-2 py-1 text-xs text-fg-2"
                      title={chip.name}
                    >
                      <span className="truncate">{chip.name}</span>
                      <span className="flex-none text-fg-3">{chip.detail}</span>
                      <button
                        type="button"
                        onClick={() => removeChip(chip.key)}
                        aria-label={`Remove ${chip.name}`}
                        className="grid h-5 w-5 flex-none place-items-center rounded-chip text-fg-3 hover:bg-fill-2 hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-line"
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <textarea
                rows={2}
                value={draft}
                disabled={startingChat}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !attaching &&
                    !startingChat &&
                    !streaming &&
                    !voice.transcribing
                  ) {
                    e.preventDefault();
                    void start();
                  }
                }}
                aria-label="New chat in project"
                placeholder="Start a new chat in this project…"
                className="block w-full resize-none border-0 bg-transparent px-1 text-[15px] leading-relaxed outline-none placeholder:text-fg-3"
              />
              <div className="mt-1 flex items-center justify-between gap-3 px-1">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  aria-label="Attach files"
                  title="Attach documents or images"
                  disabled={attaching || startingChat || streaming}
                  className="grid h-7 w-7 flex-none place-items-center rounded-field text-fg-2 hover:bg-fill-2 hover:text-fg disabled:text-text-off focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-line"
                >
                  <Paperclip size={16} />
                </button>
                <span className="hidden flex-1 text-xs text-fg-3 sm:block" aria-live="polite">
                  {voice.recording
                    ? "Listening — release to transcribe"
                    : voice.transcribing
                      ? "Transcribing…"
                      : startingChat
                        ? "Starting chat…"
                      : attaching
                        ? "Attaching…"
                        : "Enter starts the chat · Shift+Enter adds a line"}
                </span>
                <button
                  type="button"
                  onPointerDown={(event) => {
                    if (event.button !== 0) return;
                    event.preventDefault();
                    event.currentTarget.setPointerCapture(event.pointerId);
                    void voice.start();
                  }}
                  onPointerUp={() => void voice.stop()}
                  onPointerCancel={voice.cancel}
                  onLostPointerCapture={voice.cancel}
                  onKeyDown={(event) => {
                    if (event.repeat) return;
                    if (event.key === " " || event.key === "Enter") {
                      event.preventDefault();
                      void voice.start();
                    }
                  }}
                  onKeyUp={(event) => {
                    if (event.key === " " || event.key === "Enter") {
                      event.preventDefault();
                      void voice.stop();
                    }
                  }}
                  disabled={startingChat || streaming || voice.transcribing}
                  aria-label={voice.recording ? "Stop recording" : "Hold to talk"}
                  title={voice.recording ? "Release to transcribe" : "Hold to talk"}
                  className={cn(
                    "grid h-7 w-7 flex-none place-items-center rounded-field focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-line",
                    voice.recording
                      ? "bg-danger text-on-danger"
                      : "text-fg-2 hover:bg-fill-2 hover:text-fg",
                    "disabled:text-text-off",
                  )}
                >
                  <Mic size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => void start()}
                  aria-label="Start chat"
                  disabled={
                    attaching ||
                    startingChat ||
                    streaming ||
                    voice.transcribing ||
                    (draft.trim().length === 0 && chips.length === 0)
                  }
                  className="ml-auto grid h-8 w-8 place-items-center rounded-[10px] bg-accent text-accent-contrast disabled:bg-fill-2 disabled:text-text-off focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-line focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
                >
                  <ArrowUp size={16} />
                </button>
              </div>
            </div>

            <div className="mt-4">
              <PendingMemoryBar projectId={project.id} />
            </div>

            <section className="mt-5">
              <div className="mb-1 flex items-center justify-between gap-2 px-2">
                <h2 className="m-0 text-sm font-semibold">Recent chats</h2>
                <span className="text-xs tabular-nums text-fg-3">{chats.length}</span>
              </div>
              <ProjectChats
                chats={chats}
                onSelect={(id) => void selectConversation(id).catch(() => undefined)}
              />
            </section>

            {status && (
              <p className="mt-3 text-xs text-fg-3" role="status">
                {status}
              </p>
            )}
          </main>

          <aside className="flex min-w-0 flex-col gap-3 self-start @[960px]:sticky @[960px]:top-4">
            <section className="overflow-hidden rounded-card bg-raised shadow-[inset_0_0_0_1px_var(--line)]">
              <div
                role="tablist"
                aria-label="Project context sections"
                className="flex gap-1 border-b border-line-subtle px-2 pt-2"
              >
                {TABS.map((entry, index) => (
                  <button
                    key={entry.id}
                    ref={(node) => {
                      tabRefs.current[entry.id] = node;
                    }}
                    type="button"
                    role="tab"
                    id={`project-tab-${entry.id}`}
                    aria-selected={tab === entry.id}
                    aria-controls={`project-panel-${entry.id}`}
                    tabIndex={tab === entry.id ? 0 : -1}
                    onClick={() => selectTab(entry.id)}
                    onKeyDown={(event) => onTabKeyDown(event, index)}
                    className={cn(
                      "-mb-px flex h-9 min-w-0 items-center gap-1 border-b-2 px-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-line",
                      tab === entry.id
                        ? "border-accent-solid font-medium text-fg"
                        : "border-transparent text-fg-3 hover:text-fg",
                    )}
                  >
                    <span className="truncate">{entry.label}</span>
                    {counts[entry.id] !== null && (
                      <span className="rounded-full bg-fill-2 px-1.5 tabular-nums text-fg-3">
                        {counts[entry.id]}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              <div
                role="tabpanel"
                id={`project-panel-${tab}`}
                aria-labelledby={`project-tab-${tab}`}
                className="p-4"
              >
                {tab === "instructions" && (
                  <div>
                    <p className="mb-2 text-xs text-fg-3">Sent with every chat in this project.</p>
                    <Textarea
                      rows={6}
                      value={instructions}
                      onChange={(e) => setInstructions(e.target.value)}
                      aria-label="Instructions"
                      placeholder="How the assistant should behave in this project"
                    />
                    <label className="mt-3 flex flex-col gap-1 text-xs text-fg-3">
                      Description
                      <Input
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="What this project is about"
                        aria-label="Project description"
                      />
                    </label>
                    <div className="mt-3 flex items-center justify-between gap-2">
                      <span className="text-xs tabular-nums text-fg-3">
                        {instructions.trim().length.toLocaleString()} characters
                      </span>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => void save()}
                        disabled={!dirty}
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                )}

                {tab === "memory" && (
                  <div className="flex flex-col gap-2">
                    <p className="mb-0 text-xs text-fg-3">
                      {notes.length} note{notes.length === 1 ? "" : "s"} · sent with every chat
                    </p>
                    <MemoryEditor
                      memories={projectMemories}
                      emptyHint="No memory for this project yet."
                      onAdd={(d) => addMemory({ scope: "project", project_id: project.id, ...d })}
                      onUpdate={(id, d) => editMemory(id, d, "project", project.id)}
                      onDelete={(id) => deleteMemory(id, "project", project.id)}
                    />
                  </div>
                )}

                {tab === "docs" && (
                  <DocsPanel
                    docs={docs}
                    loaded={docsLoaded}
                    error={docsError}
                    removingId={removingId}
                    rebuilding={rebuilding}
                    onRebuild={() => void reindexDocs()}
                    onRemove={(doc) => void removeDoc(doc)}
                  />
                )}
              </div>
            </section>

            <section className="rounded-card bg-raised p-4 shadow-[inset_0_0_0_1px_var(--line)]">
              <div className="flex items-baseline justify-between gap-2">
                <h2 className="m-0 text-sm font-semibold">Context</h2>
                <span className="text-xs tabular-nums text-fg-2">{capacity}%</span>
              </div>
              <p className="mb-2 mt-1 text-xs text-fg-3">
                {contextChars.toLocaleString()} of 6,000 characters
              </p>
              <div
                className="h-1.5 overflow-hidden rounded-full bg-fill-2"
                role="progressbar"
                aria-label="Project context used"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={capacity}
              >
                <div
                  className={cn("h-full rounded-full transition-[width]", contextTone)}
                  style={{ width: `${capacity}%` }}
                />
              </div>
              <p className="mb-0 mt-2 text-xs text-fg-3">
                Description, instructions and memory are sent with every chat here.
              </p>
            </section>
          </aside>
        </div>
      </div>
    </div>
  );
}
