import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronsRight,
  Folder,
  FolderInput,
  FolderOpen,
  MoreHorizontal,
  Package,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings,
  Tag,
  Trash2,
} from "lucide-react";
import { useApp } from "../lib/store";
import { sessionOutputs } from "../lib/session";
import * as db from "../lib/db";
import { arrangeChats } from "../lib/grouping";
import { DropdownMenu, type MenuEntry } from "./ui/select";
import { confirmDialog } from "./ConfirmDialog";
import { Avatar, Button, Dialog, Input } from "./ui";
import { Select } from "./ui/select";
import { cn } from "../lib/utils";
import type { Conversation } from "../lib/types";

function initialsOf(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  return trimmed.slice(0, 2).toUpperCase();
}

function ChatRow({
  chat,
  working,
  renaming,
  onOpen,
  menu,
  onRenameCommit,
  onRenameCancel,
  onRenameChange,
}: {
  chat: Conversation;
  working?: boolean;
  renaming: boolean;
  onOpen: () => void;
  menu: MenuEntry[];
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  onRenameChange: (value: string) => void;
}) {
  const [draft, setDraft] = useState(chat.title);

  if (renaming) {
    return (
      <div className="flex h-[var(--chat-row-h)] items-center px-2.5">
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
          className="h-7 w-full rounded-field bg-fill-1 px-2 text-sm shadow-[inset_0_0_0_1px_var(--accent-line)] outline-none"
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
      className="group flex h-[var(--chat-row-h)] cursor-pointer items-center gap-2 rounded-field px-2.5 text-fg-2 hover:bg-fill-2 hover:text-fg"
    >
      <span className="grid w-4 flex-none place-items-center">
        {working ? (
          <span
            role="status"
            aria-label="Working"
            className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent motion-reduce:animate-none"
          />
        ) : chat.pinned === 1 ? (
          <Pin size={12} className="text-fg-3" />
        ) : null}
      </span>
      <span className="min-w-0 flex-1 truncate text-sm">{chat.title}</span>
      <DropdownMenu
        align="end"
        aria-label={`Options for ${chat.title}`}
        trigger={
          <button
            type="button"
            aria-label={`Options for ${chat.title}`}
            onClick={(e) => e.stopPropagation()}
            className="rounded-chip p-0.5 text-fg-3 opacity-0 hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
          >
            <MoreHorizontal size={14} />
          </button>
        }
        items={menu}
      />
    </div>
  );
}

function TagDialog({
  chat,
  onClose,
  onChanged,
}: {
  chat: Conversation;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [tags, setTags] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    db.listTags(chat.id)
      .then(setTags)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load tags"));
  }, [chat.id]);

  const reload = async () => {
    setTags(await db.listTags(chat.id));
    onChanged();
  };

  const add = async () => {
    if (!draft.trim()) return;
    try {
      await db.addTag(chat.id, draft);
      setDraft("");
      setError(null);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add tag");
    }
  };

  const remove = async (tag: string) => {
    try {
      await db.removeTag(chat.id, tag);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove tag");
    }
  };

  return (
    <Dialog open onClose={onClose} title={`Tags · ${chat.title}`}>
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap gap-1.5">
          {tags.length === 0 && <span className="text-xs text-muted">No tags yet.</span>}
          {tags.map((tag) => (
            <span
              key={tag}
              className="flex items-center gap-1 rounded-full bg-active px-2 py-0.5 text-xs"
            >
              {tag}
              <button
                type="button"
                aria-label={`Remove tag ${tag}`}
                onClick={() => void remove(tag)}
                className="text-muted hover:text-text"
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-1.5">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void add();
              }
            }}
            aria-label="New tag"
            placeholder="new-tag"
          />
          <Button variant="primary" size="sm" onClick={() => void add()}>
            Add
          </Button>
        </div>
        {error && (
          <p className="text-xs text-danger" role="alert">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}

export function Sidebar({ onOpenProject }: { onOpenProject: (id: string | null) => void }) {
  const {
    conversations,
    projects,
    activeConversationId,
    workingConversationId,
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
    groupByDate,
    messages,
    pendingMemories,
    activeConnection,
  } = useApp();

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [allTags, setAllTags] = useState<{ tag: string; count: number }[]>([]);
  const [tagMap, setTagMap] = useState<Map<string, string[]>>(new Map());
  const [tagDialogChat, setTagDialogChat] = useState<Conversation | null>(null);
  const outputCount = useMemo(() => sessionOutputs(messages).length, [messages]);

  const reloadTags = async () => {
    try {
      const [tags, map] = await Promise.all([db.listAllTags(), db.chatTagMap()]);
      setAllTags(tags);
      setTagMap(map);
      if (tagFilter && !tags.some((t) => t.tag === tagFilter)) setTagFilter(null);
    } catch {
      // surfaced on next read
    }
  };

  useEffect(() => {
    void reloadTags();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversations]);

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

  const shown = tagFilter
    ? conversations.filter((c) => tagMap.get(c.id)?.includes(tagFilter))
    : conversations;
  const groups = arrangeChats(
    shown.filter((chat) => !chat.project_id),
    groupByDate,
  );
  const threadsByProject = new Map<string, Conversation[]>();
  for (const chat of shown) {
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

  const chatMenu = (chat: Conversation): MenuEntry[] => [
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
        setRenameDraft(chat.title);
        setRenamingId(chat.id);
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
    { id: "tags", icon: <Tag size={16} />, label: "Tags…", onSelect: () => setTagDialogChat(chat) },
    { id: "chat-sep", type: "separator" },
    {
      id: "delete",
      icon: <Trash2 size={16} />,
      label: "Delete",
      danger: true,
      onSelect: () => void askDelete(chat),
    },
  ];

  const profileMenu: MenuEntry[] = [
    {
      id: "settings",
      icon: <Settings size={16} />,
      label: "Settings",
      onSelect: () => setSettingsPage("general"),
    },
    { id: "memory", label: "Global memory", onSelect: () => setSettingsPage("memory") },
    { id: "changelog", label: "What's new", onSelect: () => setSettingsPage("changelog") },
  ];

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
            aria-label={
              pendingMemories.length > 0
                ? `Settings, ${pendingMemories.length} ${
                    pendingMemories.length === 1 ? "memory" : "memories"
                  } waiting for review`
                : "Settings"
            }
            title="Settings (Ctrl+,)"
            onClick={() => setSettingsPage("general")}
            className="relative grid h-8 w-8 place-items-center rounded-control text-muted hover:bg-hover hover:text-text"
          >
            <Settings size={16} />
            {pendingMemories.length > 0 && (
              <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-contrast">
                {pendingMemories.length > 9 ? "9+" : pendingMemories.length}
              </span>
            )}
          </button>
          <Avatar initials={initialsOf(displayName)} />
        </div>
      </aside>
    );
  }

  return (
    <aside className="flex h-full w-[264px] shrink-0 flex-col overflow-hidden bg-sunken">
      <div className="flex flex-col gap-1 px-2 pb-1 pt-2">
        <Button
          variant="primary"
          className="h-9 w-full justify-start px-3 text-sm"
          onClick={() => void newConversation().catch(() => undefined)}
          title="New chat (Ctrl+N)"
        >
          <Plus size={16} />
          <span>New chat</span>
          <kbd className="ml-auto border-0 bg-white/15 text-white/80">Ctrl N</kbd>
        </Button>
        <nav className="mt-1 flex flex-col gap-0.5">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            title="Search (Ctrl+K)"
            className="flex h-[34px] items-center gap-2.5 rounded-field px-2.5 text-sm text-fg-2 hover:bg-fill-2 hover:text-fg"
          >
            <Search size={16} className="text-fg-3" />
            <span>Search</span>
          </button>
          <button
            type="button"
            onClick={() => setView("projects")}
            title="All projects"
            className={cn(
              "flex h-[34px] items-center gap-2.5 rounded-field px-2.5 text-sm text-fg-2 hover:bg-fill-2 hover:text-fg",
              (view === "projects" || view === "project") && "bg-fill-3 text-fg",
            )}
          >
            <Folder size={16} className="text-fg-3" />
            <span>All projects</span>
          </button>
          <button
            type="button"
            onClick={() => setView("outputs")}
            title="Outputs"
            className={cn(
              "flex h-[34px] items-center gap-2.5 rounded-field px-2.5 text-sm text-fg-2 hover:bg-fill-2 hover:text-fg",
              view === "outputs" && "bg-fill-3 text-fg",
            )}
          >
            <Package size={16} className="text-fg-3" />
            <span>Outputs</span>
            {outputCount > 0 && (
              <span className="ml-auto text-xs tabular-nums text-fg-3">{outputCount}</span>
            )}
          </button>
        </nav>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2">
        {allTags.length > 0 && (
          <div className="flex items-center gap-1.5 px-1 pb-1 pt-2">
            <Tag size={14} className="flex-none text-fg-3" />
            <Select
              size="sm"
              className="min-w-0 flex-1"
              value={tagFilter}
              onChange={(next) => setTagFilter(next || null)}
              aria-label="Filter by tag"
              options={[
                { value: "", label: "All tags" },
                ...allTags.map((t) => ({ value: t.tag, label: `${t.tag} (${t.count})` })),
              ]}
            />
            {tagFilter && (
              <button
                type="button"
                aria-label="Clear tag filter"
                onClick={() => setTagFilter(null)}
                className="text-xs text-fg-3 hover:text-fg"
              >
                ×
              </button>
            )}
          </div>
        )}

        <button
          type="button"
          aria-label="Projects"
          className="mt-3 flex h-7 items-center gap-1 rounded-chip px-2 text-xs font-medium text-fg-3 hover:text-fg-2"
        >
          <span>Projects</span>
        </button>
        {topProjects.map((entry) => (
          <div key={entry.project.id}>
            <div
              className={cn(
                "group flex h-[var(--chat-row-h)] items-center gap-1 rounded-field px-1.5 text-fg-2",
                activeProjectId === entry.project.id
                  ? "bg-fill-3 text-fg"
                  : "hover:bg-fill-2 hover:text-fg",
              )}
            >
              <button
                type="button"
                aria-label={expandedProjects.has(entry.project.id) ? "Collapse" : "Expand"}
                aria-expanded={expandedProjects.has(entry.project.id)}
                onClick={() => toggleProjectExpanded(entry.project.id)}
                className="grid w-4 flex-none place-items-center text-fg-3 hover:text-fg"
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
                className="rounded-chip p-0.5 text-fg-3 opacity-0 hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
              >
                <Plus size={14} />
              </button>
              <button
                type="button"
                aria-label={`Edit ${entry.project.name}`}
                onClick={() => onOpenProject(entry.project.id)}
                className="rounded-chip p-0.5 text-fg-3 opacity-0 hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
              >
                <Settings size={14} />
              </button>
            </div>
            {expandedProjects.has(entry.project.id) && (
              <div className="flex flex-col">
                {entry.threads.map((thread) => (
                  <button
                    key={thread.id}
                    type="button"
                    onClick={() => openChat(thread.id)}
                    title={thread.title}
                    className={cn(
                      "flex h-[var(--chat-row-h)] w-full items-center gap-2 rounded-field pl-7 pr-2.5 text-left text-sm text-fg-2 hover:bg-fill-2 hover:text-fg",
                      activeConversationId === thread.id && "bg-fill-3 text-fg",
                    )}
                  >
                    <span className="grid w-4 flex-none place-items-center">
                      {thread.id === workingConversationId && (
                        <span
                          role="status"
                          aria-label="Working"
                          className="h-3 w-3 animate-spin rounded-full border-2 border-accent border-t-transparent motion-reduce:animate-none"
                        />
                      )}
                    </span>
                    <span className="truncate">{thread.title}</span>
                  </button>
                ))}
                {entry.threads.length === 0 && (
                  <span className="px-2 py-1 pl-7 text-xs text-fg-3">No chats yet</span>
                )}
              </div>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={() => onOpenProject(null)}
          className="flex h-[var(--chat-row-h)] items-center gap-2 rounded-field px-1.5 text-left text-sm text-fg-3 hover:bg-fill-2 hover:text-fg-2"
        >
          <span className="grid w-4 place-items-center">
            <Plus size={14} />
          </span>
          New project
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
                className="group mt-3 flex h-7 w-full items-center gap-1 rounded-chip px-2 text-left text-xs font-medium text-fg-3 hover:text-fg-2"
              >
                <ChevronDown
                  size={12}
                  className={cn("transition-transform", collapsed && "-rotate-90")}
                />
                <span className="flex-1">{group.name}</span>
              </button>
              {!collapsed &&
                group.items.map((chat) => (
                  <ChatRow
                    key={chat.id}
                    chat={chat}
                    working={chat.id === workingConversationId}
                    renaming={renamingId === chat.id}
                    onOpen={() => openChat(chat.id)}
                    menu={chatMenu(chat)}
                    onRenameCommit={() => void commitRename()}
                    onRenameCancel={() => setRenamingId(null)}
                    onRenameChange={setRenameDraft}
                  />
                ))}
            </div>
          );
        })}
        {ready && conversations.length === 0 && (
          <p className="px-2.5 py-4 text-xs text-fg-3">No chats yet.</p>
        )}
      </div>

      <div className="mt-1 flex items-center gap-1 border-t border-line-subtle px-2 py-2">
        <DropdownMenu
          align="start"
          aria-label="Profile"
          className="min-w-48"
          trigger={
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 rounded-field p-1 text-left hover:bg-fill-2"
            >
              <Avatar initials={initialsOf(displayName)} />
              <span className="flex min-w-0 flex-col leading-tight">
                <b className="truncate text-[13px] font-medium">{displayName || "Local user"}</b>
                <small className="flex items-center gap-1.5 text-xs text-fg-3">
                  <i
                    className={cn(
                      "h-1.5 w-1.5 rounded-full",
                      activeConnection ? "bg-success" : "bg-fg-3",
                    )}
                  />
                  {activeConnection ? `${activeConnection.name} · key OK` : "No provider"}
                </small>
              </span>
            </button>
          }
          items={profileMenu}
        />
        <button
          type="button"
          aria-label={
            pendingMemories.length > 0
              ? `Settings, ${pendingMemories.length} ${
                  pendingMemories.length === 1 ? "memory" : "memories"
                } waiting for review`
              : "Settings"
          }
          title="Settings (Ctrl+,)"
          onClick={() => setSettingsPage("general")}
          className="relative grid h-8 w-8 flex-none place-items-center rounded-field text-fg-2 hover:bg-fill-2 hover:text-fg"
        >
          <Settings size={18} />
          {pendingMemories.length > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-contrast">
              {pendingMemories.length > 9 ? "9+" : pendingMemories.length}
            </span>
          )}
        </button>
      </div>
      {tagDialogChat && (
        <TagDialog
          chat={tagDialogChat}
          onClose={() => setTagDialogChat(null)}
          onChanged={() => void reloadTags()}
        />
      )}
    </aside>
  );
}
