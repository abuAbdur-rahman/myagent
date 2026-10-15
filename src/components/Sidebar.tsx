import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  ChevronsLeft,
  ChevronsRight,
  Folder,
  FolderInput,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  Trash2,
} from "lucide-react";
import { useApp } from "../lib/store";
import { groupChats, projectColor } from "../lib/grouping";
import { MenuItem, MenuSeparator, showMenu } from "./Menu";
import { confirmDialog } from "./ConfirmDialog";
import { Avatar, Button } from "./ui";
import { cn } from "../lib/utils";
import type { Conversation } from "../lib/types";

function initialsOf(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return trimmed.slice(0, 2).toUpperCase();
}

function ChatRow({
  chat,
  projectName,
  dotColor,
  renaming,
  onOpen,
  onMenu,
  onRenameCommit,
  onRenameCancel,
  onRenameChange,
}: {
  chat: Conversation;
  projectName: string | null;
  dotColor: string | null;
  renaming: boolean;
  onOpen: () => void;
  onMenu: (anchor: HTMLElement) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  onRenameChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(chat.title);

  if (renaming) {
    return (
      <div className="flex h-[34px] items-center px-2.5">
        <input
          autoFocus
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            onRenameChange(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onRenameCommit();
            } else if (e.key === "Escape") {
              onRenameCancel();
            }
          }}
          onBlur={onRenameCommit}
          aria-label="Rename chat"
          className="h-7 w-full rounded-control border border-accent bg-surface px-1.5 text-sm outline-none"
        />
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen();
      }}
      className="group flex h-[34px] cursor-pointer items-center gap-2 rounded-control px-2.5"
    >
      {dotColor && (
        <span
          className="h-2 w-2 flex-none rounded-full"
          style={{ background: dotColor }}
          title={projectName ?? undefined}
        />
      )}
      <span className="min-w-0 flex-1 truncate text-sm">{chat.title}</span>
      <button
        type="button"
        aria-label={`Options for ${chat.title}`}
        onClick={(e) => {
          e.stopPropagation();
          onMenu(e.currentTarget);
        }}
        className="invisible ml-auto rounded-control text-muted hover:text-text focus-visible:visible group-hover:visible"
      >
        <MoreHorizontal size={16} />
      </button>
    </div>
  );
}

export function Sidebar({ onOpenProject }: { onOpenProject: (id: string | null) => void }) {
  const {
    conversations,
    projects,
    activeConversationId,
    selectConversation,
    newConversation,
    removeConversation,
    renameConversation,
    togglePin,
    moveConversation,
    ready,
    sidebarCollapsed,
    toggleSidebar,
    setPaletteOpen,
    setSettingsPage,
    displayName,
    activeProjectId,
    selectProject,
    view,
    setView,
  } = useApp();

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    () => new Set(["Older"]),
  );

  const toggleGroupCollapsed = (name: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const projectById = new Map(projects.map((p) => [p.id, p]));
  const groups = groupChats(conversations);

  const threadsByProject = new Map<string, Conversation[]>();
  for (const chat of conversations) {
    if (!chat.project_id) continue;
    const list = threadsByProject.get(chat.project_id) ?? [];
    list.push(chat);
    threadsByProject.set(chat.project_id, list);
  }
  const topProjects = projects
    .map((project) => {
      const threads = (threadsByProject.get(project.id) ?? [])
        .slice()
        .sort((a, b) => b.updated_at - a.updated_at);
      const activity = threads[0]?.updated_at ?? project.updated_at;
      return { project, threads: threads.slice(0, 5), activity };
    })
    .sort((a, b) => b.activity - a.activity)
    .slice(0, 2);

  const toggleProjectExpanded = (id: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const openChat = (id: string) => {
    void selectConversation(id).catch(() => undefined);
  };

  const commitRename = async () => {
    if (!renamingId) return;
    const id = renamingId;
    setRenamingId(null);
    try {
      await renameConversation(id, renameDraft);
    } catch {
      // surfaced on next read
    }
  };

  const askDelete = async (chat: Conversation) => {
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

  const openMenu = (chat: Conversation, anchor: HTMLElement) => {
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
            setRenameDraft(chat.title);
            setRenamingId(chat.id);
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
        <MenuSeparator />
        <MenuItem
          icon={<Trash2 size={16} />}
          label="Delete"
          danger
          onSelect={() => void askDelete(chat)}
        />
      </>,
      { align: "right" },
    );
  };

  const openProfileMenu = (anchor: HTMLElement) => {
    showMenu(
      anchor,
      <>
        <MenuItem
          icon={<Settings size={16} />}
          label="Settings"
          onSelect={() => setSettingsPage("general")}
        />
        <MenuItem label="Global memory" onSelect={() => setSettingsPage("memory")} />
      </>,
      { align: "left", above: true },
    );
  };

  if (sidebarCollapsed) {
    return (
      <aside className="flex h-full w-14 shrink-0 flex-col items-center bg-sidebar py-1.5">
        <button
          type="button"
          aria-label="Expand sidebar"
          title="Expand sidebar (Ctrl+B)"
          onClick={toggleSidebar}
          className="grid h-8 w-8 place-items-center rounded-control text-muted hover:bg-hover hover:text-text"
        >
          <ChevronsRight size={16} />
        </button>
        <div className="mt-1.5 flex flex-col items-center gap-0.5">
          <button
            type="button"
            aria-label="New chat"
            title="New chat (Ctrl+N)"
            onClick={() => void newConversation().catch(() => undefined)}
            className="grid h-8 w-8 place-items-center rounded-control text-muted hover:bg-hover hover:text-text"
          >
            <Plus size={16} />
          </button>
          <button
            type="button"
            aria-label="Search"
            title="Search (Ctrl+K)"
            onClick={() => setPaletteOpen(true)}
            className="grid h-8 w-8 place-items-center rounded-control text-muted hover:bg-hover hover:text-text"
          >
            <Search size={16} />
          </button>
        </div>
        <div className="flex-1" />
        <div className="flex flex-col items-center gap-1">
          <button
            type="button"
            aria-label="Settings"
            title="Settings (Ctrl+,)"
            onClick={() => setSettingsPage("general")}
            className="grid h-8 w-8 place-items-center rounded-control text-muted hover:bg-hover hover:text-text"
          >
            <Settings size={16} />
          </button>
          <Avatar initials={initialsOf(displayName)} />
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col overflow-hidden bg-sidebar">
      <div className="flex justify-end px-2 pt-1.5">
        <button
          type="button"
          aria-label="Collapse sidebar"
          title="Collapse sidebar (Ctrl+B)"
          onClick={toggleSidebar}
          className="grid h-8 w-8 place-items-center rounded-control text-muted hover:bg-hover hover:text-text"
        >
          <ChevronsLeft size={16} />
        </button>
      </div>

      <div className="flex flex-col gap-0.5 px-2.5 py-1.5">
        <Button
          variant="primary"
          className="w-full justify-start"
          onClick={() => void newConversation().catch(() => undefined)}
          title="New chat (Ctrl+N)"
        >
          <Plus size={16} />
          <span>New chat</span>
          <kbd className="ml-auto border-white/40 bg-transparent text-inherit">Ctrl+N</kbd>
        </Button>
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          title="Search (Ctrl+K)"
          className="flex h-8 items-center gap-2.5 rounded-control px-2.5 text-sm hover:bg-hover"
        >
          <Search size={16} className="text-muted" />
          <span>Search</span>
        </button>
        <button
          type="button"
          onClick={() => setView("projects")}
          title="Projects"
          className={cn(
            "flex h-8 items-center gap-2.5 rounded-control px-2.5 text-sm hover:bg-hover",
            view !== "chat" && "bg-active",
          )}
        >
          <Folder size={16} className="text-muted" />
          <span>Projects</span>
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2">
        <div className="px-2.5 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wider text-muted">
          Projects
        </div>
        {topProjects.map((entry) => (
          <div key={entry.project.id}>
            <div
              className={cn(
                "group flex h-8 items-center gap-1 rounded-control px-2",
                activeProjectId === entry.project.id ? "bg-active" : "hover:bg-hover",
              )}
            >
              <button
                type="button"
                aria-label={expandedProjects.has(entry.project.id) ? "Collapse" : "Expand"}
                aria-expanded={expandedProjects.has(entry.project.id)}
                onClick={() => toggleProjectExpanded(entry.project.id)}
                className="grid h-6 w-6 flex-none place-items-center rounded text-muted hover:text-text"
              >
                {expandedProjects.has(entry.project.id) ? (
                  <FolderOpen size={14} />
                ) : (
                  <Folder size={14} />
                )}
              </button>
              <button
                type="button"
                onClick={() => selectProject(entry.project.id)}
                className="min-w-0 flex-1 truncate text-left text-sm"
                title={entry.project.name}
              >
                {entry.project.name}
              </button>
              <button
                type="button"
                aria-label={`New chat in ${entry.project.name}`}
                title={`New chat in ${entry.project.name}`}
                onClick={() => selectProject(entry.project.id)}
                className="invisible rounded-control px-1 text-muted hover:text-text focus-visible:visible group-hover:visible"
              >
                <Plus size={14} />
              </button>
              <button
                type="button"
                aria-label={`Edit ${entry.project.name}`}
                onClick={() => onOpenProject(entry.project.id)}
                className="invisible rounded-control px-1 text-muted hover:text-text focus-visible:visible group-hover:visible"
              >
                <Settings size={14} />
              </button>
            </div>
            {expandedProjects.has(entry.project.id) && (
              <div className="ml-7 flex flex-col">
                {entry.threads.map((thread) => (
                  <button
                    key={thread.id}
                    type="button"
                    onClick={() => openChat(thread.id)}
                    title={thread.title}
                    className={cn(
                      "h-7 truncate rounded-control px-2 text-left text-[13px] text-muted hover:bg-hover hover:text-text",
                      activeConversationId === thread.id && "bg-active text-text",
                    )}
                  >
                    {thread.title}
                  </button>
                ))}
                {entry.threads.length === 0 && (
                  <span className="px-2 py-1 text-xs text-muted">No chats yet</span>
                )}
              </div>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={() => onOpenProject(null)}
          className="flex h-8 items-center gap-2 rounded-control px-2 text-left text-[13px] text-muted hover:bg-hover hover:text-text"
        >
          <Plus size={14} /> New project
        </button>

        {groups.map((group) => {
          const collapsed = collapsedGroups.has(group.name);
          return (
            <div key={group.name}>
              <button
                type="button"
                onClick={() => toggleGroupCollapsed(group.name)}
                aria-expanded={!collapsed}
                aria-label={`${collapsed ? "Expand" : "Collapse"} ${group.name}`}
                className="group sticky top-0 flex w-full items-center gap-1 bg-sidebar px-2.5 pb-1 pt-2.5 text-left text-[11px] font-medium uppercase tracking-wider text-muted"
              >
                <span className="flex-1">{group.name}</span>
                <span className="grid h-5 w-5 place-items-center rounded-control opacity-40 hover:text-text hover:opacity-100 focus-visible:opacity-100 group-hover:opacity-100">
                  {collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                </span>
              </button>
              {!collapsed &&
                group.items.map((chat) => {
                  const project = chat.project_id ? projectById.get(chat.project_id) : undefined;
                  const isActive = chat.id === activeConversationId;
                  return (
                    <div
                      key={chat.id}
                      className={cn("relative rounded-control", isActive && "bg-active")}
                    >
                      {isActive && (
                        <span className="absolute bottom-2 left-0 top-2 w-[3px] rounded bg-accent" />
                      )}
                      <ChatRow
                        chat={chat}
                        projectName={project?.name ?? null}
                        dotColor={project ? projectColor(project.id) : null}
                        renaming={renamingId === chat.id}
                        onOpen={() => openChat(chat.id)}
                        onMenu={(anchor) => openMenu(chat, anchor)}
                        onRenameCommit={() => void commitRename()}
                        onRenameCancel={() => setRenamingId(null)}
                        onRenameChange={setRenameDraft}
                      />
                    </div>
                  );
                })}
            </div>
          );
        })}
        {ready && conversations.length === 0 && (
          <p className="px-2.5 py-4 text-xs text-muted">No chats yet.</p>
        )}
      </div>

      <div className="flex items-center gap-1.5 border-t border-border p-2">
        <button
          type="button"
          aria-label="Settings"
          title="Settings (Ctrl+,)"
          onClick={() => setSettingsPage("general")}
          className="grid h-8 w-8 flex-none place-items-center rounded-control text-muted hover:bg-hover hover:text-text"
        >
          <Settings size={16} />
        </button>
        <button
          type="button"
          onClick={(e) => openProfileMenu(e.currentTarget)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-control p-1 text-left hover:bg-hover"
        >
          <Avatar initials={initialsOf(displayName)} />
          <span className="flex min-w-0 flex-col leading-tight">
            <b className="truncate text-[13px]">{displayName || "Local user"}</b>
            <small className="text-muted">BYOK</small>
          </span>
        </button>
      </div>
    </aside>
  );
}
