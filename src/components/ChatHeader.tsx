import { useRef, useState } from "react";
import { Cpu, Download, FolderInput, ListChecks, MessageSquare, MoreHorizontal, PanelRight, Pencil, Pin, PinOff, Trash2, Upload } from "lucide-react";
import { useApp } from "../lib/store";
import { projectColor } from "../lib/grouping";
import { stepLabel } from "../lib/session";
import { buildChatExport, conversationToMarkdown, importChatExport, safeFilename } from "../lib/export";
import { DropdownMenu, type MenuEntry } from "./ui/select";
import { confirmDialog } from "./ConfirmDialog";
import { openModelPicker } from "./ModelPicker";
import { Button, Dialog, IconButton, Textarea } from "./ui";
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
    activeConnection,
    model,
    messages,
    togglePanel,
    panelOpen,
    openSessionPanel,
    todos,
    refreshConversations,
    selectConversation,
  } = useApp();
  const step = stepLabel(todos);
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
        { id: "export-md", icon: <Download size={16} />, label: "Export", onSelect: exportChat },
        {
          id: "export-json",
          icon: <Download size={16} />,
          label: "Export JSON",
          onSelect: exportJson,
        },
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
    <div className="flex h-12 flex-none items-center gap-2 border-b border-border py-0 pl-4 pr-3">
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
          className="h-7 max-w-[300px] rounded-control border border-accent bg-surface px-1.5 text-sm font-semibold outline-none"
        />
      ) : chat ? (
        <button
          type="button"
          onClick={() => {
            setDraft(chat.title);
            setRenaming(true);
          }}
          title="Rename"
          className="max-w-[40%] truncate rounded-control px-2 py-1 text-left text-sm font-semibold hover:bg-hover"
        >
          {chat.title}
        </button>
      ) : (
        <span className="px-2 py-1 text-sm font-semibold">New chat</span>
      )}

      {project && (
        <span className="flex max-w-[220px] items-center gap-1.5 rounded bg-hover px-2 py-1 text-xs text-muted">
          <span className="h-2 w-2 flex-none rounded-full" style={{ background: projectColor(project.id) }} />
          <span className="truncate">{project.name}</span>
        </span>
      )}

      <button
        type="button"
        onClick={(e) => openModelPicker(e.currentTarget)}
        title="Model"
        className="flex max-w-[220px] items-center gap-1.5 rounded bg-hover px-2 py-1 text-xs text-muted hover:text-text"
      >
        <Cpu size={14} />
        <span className="truncate">
          {activeConnection && model ? `${activeConnection.name} · ${model}` : "Select model"}
        </span>
      </button>

      <span className="flex-1" />

      {step && (
        <button
          type="button"
          onClick={openSessionPanel}
          aria-label={`Open progress: ${step}`}
          title={`${step} · open progress`}
          className="flex items-center gap-1.5 rounded-control px-2 py-1 text-xs text-muted hover:bg-hover hover:text-text"
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
        label="Toggle side panel"
        title="Progress and artifacts (Ctrl+Shift+A)"
        aria-expanded={panelOpen}
        onClick={togglePanel}
      >
        <PanelRight size={16} />
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
