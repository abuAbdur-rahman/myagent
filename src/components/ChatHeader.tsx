import { useRef, useState } from "react";
import { Download, FolderInput, ListChecks, MessageSquare, MoreHorizontal, PanelLeft, PanelRight, Pencil, Pin, PinOff, Trash2, Upload } from "lucide-react";
import { useApp } from "../lib/store";
import { stepLabel } from "../lib/session";
import { buildChatExport, conversationToMarkdown, importChatExport, safeFilename } from "../lib/export";
import { DropdownMenu, type MenuEntry } from "./ui/select";
import { confirmDialog } from "./ConfirmDialog";
import { Button, Dialog, IconButton, Textarea } from "./ui";
import { ContextRing } from "./ContextRing";
import { copyText, downloadText, errorText } from "../lib/utils";
import { toast } from "../lib/toast";

export function ChatHeader() {
  const {
    conversations,
    activeConversationId,
    projects,
    renameConversation,
    setChatPrompt,
    togglePin,
    moveConversation,
    removeConversation,
    messages,
    toggleSidebar,
    togglePanel,
    panelOpen,
    openSessionPanel,
    openContextPanel,
    contextInfo,
    todos,
    refreshConversations,
    selectConversation,
    selectProject,
  } = useApp();
  const step = stepLabel(todos);
  const contextPct = contextInfo.pct;
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");
  const [promptOpen, setPromptOpen] = useState(false);
  const [promptDraft, setPromptDraft] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const chat = conversations.find((c) => c.id === activeConversationId) ?? null;
  const project = chat?.project_id ? projects.find((p) => p.id === chat.project_id) : undefined;

  const commitRename = async () => {
    if (!chat) return;
    setRenaming(false);
    try {
      await renameConversation(chat.id, draft);
    } catch {
      // surfaced on next read
    }
  };

  const askDelete = async () => {
    if (!chat) return;
    const confirmed = await confirmDialog({
      title: "Delete chat?",
      body: `“${chat.title}” will be removed.`,
      danger: true,
      ok: "Delete",
    });
    if (!confirmed) return;
    try {
      await removeConversation(chat.id);
    } catch {
      // surfaced on next read
    }
  };

  const exportChat = () => {
    if (!chat) return;
    downloadText(safeFilename(chat.title), conversationToMarkdown(chat.title, messages));
    toast("Chat exported");
  };

  const exportJson = () => {
    if (!chat) return;
    downloadText(
      safeFilename(chat.title, "json"),
      JSON.stringify(buildChatExport(chat, messages), null, 2),
      "application/json",
    );
    toast("Chat exported as JSON");
  };

  const importFile = async (file: File) => {
    try {
      const text = await file.text();
      const id = await importChatExport(text);
      await refreshConversations();
      await selectConversation(id);
      toast("Chat imported");
    } catch (e) {
      toast(e instanceof Error ? e.message : "Import failed");
    }
  };

  const chatMenu: MenuEntry[] = chat
    ? [
        {
          id: "pin",
          icon: chat.pinned === 1 ? <PinOff size={16} /> : <Pin size={16} />,
          label: chat.pinned === 1 ? "Unpin" : "Pin",
          onSelect: () => void togglePin(chat.id).catch(() => undefined),
        },
        {
          id: "rename",
          icon: <Pencil size={16} />,
          label: "Rename",
          onSelect: () => {
            setDraft(chat.title);
            setRenaming(true);
          },
        },
        {
          id: "chat-prompt",
          icon: <MessageSquare size={16} />,
          label: "Chat instructions…",
          onSelect: () => {
            setPromptDraft(chat.system_prompt ?? "");
            setPromptOpen(true);
          },
        },
        {
          id: "move",
          type: "submenu",
          icon: <FolderInput size={16} />,
          label: "Move to project…",
          items: [
            ...projects.map((p) => ({
              id: `project-${p.id}`,
              label: p.name,
              onSelect: () => void moveConversation(chat.id, p.id).catch(() => undefined),
            })),
            { id: "move-sep", type: "separator" },
            {
              id: "move-none",
              label: "No project",
              onSelect: () => void moveConversation(chat.id, null).catch(() => undefined),
            },
          ],
        },
        {
          id: "export",
          type: "submenu",
          icon: <Download size={16} />,
          label: "Export",
          items: [
            {
              id: "export-md",
              label: "As Markdown",
              onSelect: exportChat,
            },
            {
              id: "export-json",
              label: "As JSON",
              onSelect: exportJson,
            },
          ],
        },
        { id: "export-sep", type: "separator" },
        {
          id: "import",
          icon: <Upload size={16} />,
          label: "Import chat…",
          onSelect: () => fileRef.current?.click(),
        },
        { id: "menu-sep", type: "separator" },
        {
          id: "delete",
          icon: <Trash2 size={16} />,
          label: "Delete",
          danger: true,
          onSelect: () => void askDelete(),
        },
      ]
    : [];

  return (
    <>
    <div className="flex h-12 flex-none items-center gap-1 border-b border-line-subtle pl-2 pr-2">
      <IconButton label="Toggle sidebar" title="Toggle sidebar (Ctrl+B)" onClick={toggleSidebar}>
        <PanelLeft size={18} />
      </IconButton>
      {renaming && chat ? (
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void commitRename();
            } else if (e.key === "Escape") {
              setRenaming(false);
            }
          }}
          onBlur={() => void commitRename()}
          aria-label="Rename chat"
          className="h-7 max-w-[300px] rounded-field bg-fill-1 px-2 text-sm font-medium shadow-[inset_0_0_0_1px_var(--accent-line)] outline-none"
        />
      ) : (
        <div className="flex min-w-0 items-center gap-1.5 pl-1 text-sm">
          {project && (
            <>
              <button
                type="button"
                onClick={() => selectProject(project.id)}
                title={`Open ${project.name}`}
                className="max-w-[160px] truncate rounded-chip px-1 text-fg-3 hover:bg-fill-2 hover:text-fg-2"
              >
                {project.name}
              </button>
              <span className="text-text-off" aria-hidden="true">
                /
              </span>
            </>
          )}
          {chat ? (
            <button
              type="button"
              onClick={() => {
                setDraft(chat.title);
                setRenaming(true);
              }}
              title="Rename chat"
              className="max-w-[42vw] truncate rounded-chip px-1 py-0.5 text-left font-medium hover:bg-fill-2"
            >
              {chat.title}
            </button>
          ) : (
            <span className="px-1 py-0.5 font-medium">New chat</span>
          )}
        </div>
      )}

      <span className="flex-1" />

      {step && (
        <button
          type="button"
          onClick={openSessionPanel}
          aria-label={`Open progress: ${step}`}
          title={`${step} · open progress`}
          className="flex h-7 items-center gap-1.5 rounded-field px-2 text-xs text-fg-3 hover:bg-fill-2 hover:text-fg"
        >
          <ListChecks size={14} />
          {step}
        </button>
      )}

      {chat && (
        <DropdownMenu
          align="end"
          aria-label="Chat options"
          trigger={
            <IconButton label="Chat options">
              <MoreHorizontal size={16} />
            </IconButton>
          }
          items={chatMenu}
        />
      )}
      <IconButton
        label="Context inspector"
        title={`Context · ${contextPct ?? 0}% used`}
        onClick={openContextPanel}
      >
        <ContextRing pct={contextPct} warn={contextPct !== null && contextPct >= 80} />
      </IconButton>
      <IconButton
        label="Toggle side panel"
        title="Progress and artifacts (Ctrl+Shift+A)"
        aria-expanded={panelOpen}
        onClick={togglePanel}
      >
        <PanelRight size={18} />
      </IconButton>
      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        aria-label="Import chat file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void importFile(file);
        }}
      />
    </div>
    <Dialog
      open={promptOpen}
      onClose={() => setPromptOpen(false)}
      title="Instructions for this chat"
    >
      <div className="flex flex-col gap-2.5">
        <p className="m-0 text-xs text-muted">
          Added after the app's standing instructions and the project block, and only for this
          chat. Leave it empty to inherit everything else.
        </p>
        <Textarea
          rows={6}
          value={promptDraft}
          onChange={(event) => setPromptDraft(event.target.value)}
          placeholder="e.g. You are reviewing a Rust codebase. Quote file paths."
          aria-label="Chat instructions"
        />
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            disabled={!chat?.system_prompt}
            onClick={() => {
              if (!chat) return;
              setChatPrompt(chat.id, null)
                .then(() => {
                  setPromptOpen(false);
                  toast("Chat instructions cleared");
                })
                .catch((e) => toast(errorText(e)));
            }}
          >
            Clear
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              if (!chat) return;
              setChatPrompt(chat.id, promptDraft)
                .then(() => {
                  setPromptOpen(false);
                  toast(
                    promptDraft.trim() ? "Chat instructions saved" : "Chat instructions cleared",
                  );
                })
                .catch((e) => toast(errorText(e)));
            }}
          >
            Save
          </Button>
        </div>
      </div>
    </Dialog>
    </>
  );
}

export function copyWithToast(text: string) {
  return copyText(text).then((ok) => {
    toast(ok ? "Copied" : "Copy failed");
  });
}
