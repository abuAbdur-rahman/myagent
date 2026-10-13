import { useState } from "react";
import { Cpu, Download, FolderInput, MoreHorizontal, PanelRight, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import { useApp } from "../lib/store";
import { projectColor } from "../lib/grouping";
import { conversationToMarkdown, safeFilename } from "../lib/export";
import { MenuItem, MenuSeparator, showMenu } from "./Menu";
import { confirmDialog } from "./ConfirmDialog";
import { openModelPicker } from "./ModelPicker";
import { IconButton } from "./ui";
import { copyText, downloadText } from "../lib/utils";
import { toast } from "../lib/toast";

export function ChatHeader() {
  const {
    conversations,
    activeConversationId,
    projects,
    renameConversation,
    togglePin,
    moveConversation,
    removeConversation,
    activeConnection,
    model,
    messages,
    togglePanel,
    panelArtifact,
  } = useApp();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState("");

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

  const openMenu = (anchor: HTMLElement) => {
    if (!chat) return;
    showMenu(
      anchor,
      <>
        <MenuItem
          icon={chat.pinned === 1 ? <PinOff size={16} /> : <Pin size={16} />}
          label={chat.pinned === 1 ? "Unpin" : "Pin"}
          onSelect={() => void togglePin(chat.id).catch(() => undefined)}
        />
        <MenuItem
          icon={<Pencil size={16} />}
          label="Rename"
          onSelect={() => {
            setDraft(chat.title);
            setRenaming(true);
          }}
        />
        <MenuItem
          icon={<FolderInput size={16} />}
          label="Move to project…"
          onSelect={() =>
            showMenu(
              anchor,
              <>
                {projects.map((p) => (
                  <MenuItem
                    key={p.id}
                    label={p.name}
                    onSelect={() => void moveConversation(chat.id, p.id).catch(() => undefined)}
                  />
                ))}
                <MenuSeparator />
                <MenuItem
                  label="No project"
                  onSelect={() => void moveConversation(chat.id, null).catch(() => undefined)}
                />
              </>,
              { align: "right" },
            )
          }
        />
        <MenuItem
          icon={<Download size={16} />}
          label="Export"
          onSelect={exportChat}
        />
        <MenuSeparator />
        <MenuItem
          icon={<Trash2 size={16} />}
          label="Delete"
          danger
          onSelect={() => void askDelete()}
        />
      </>,
      { align: "right" },
    );
  };

  return (
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

      {chat && (
        <IconButton
          label="Chat options"
          onClick={(e) => openMenu(e.currentTarget)}
        >
          <MoreHorizontal size={16} />
        </IconButton>
      )}
      <IconButton
        label="Toggle artifact panel"
        title={panelArtifact ? "Artifacts (Ctrl+Shift+A)" : "No artifacts yet"}
        onClick={togglePanel}
        disabled={!panelArtifact}
      >
        <PanelRight size={16} />
      </IconButton>
    </div>
  );
}

export function copyWithToast(text: string) {
  return copyText(text).then((ok) => {
    toast(ok ? "Copied" : "Copy failed");
  });
}
