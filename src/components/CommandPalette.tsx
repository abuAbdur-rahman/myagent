import { useEffect, useMemo, useRef, useState } from "react";
import {
  Folder,
  MessageSquare,
  PanelLeft,
  Plus,
  Search,
  Settings,
  Database,
} from "lucide-react";
import { useApp } from "../lib/store";
import { cn } from "../lib/utils";

interface Entry {
  section: string;
  label: string;
  icon: React.ReactNode;
  run: () => void;
}

export function CommandPalette({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const {
    conversations,
    projects,
    selectConversation,
    selectProject,
    newConversation,
    toggleSidebar,
    setPaletteOpen,
    setSettingsPage,
  } = useApp();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const entries = useMemo<Entry[]>(() => {
    return [
      {
        section: "Actions",
        label: "New chat",
        icon: <Plus size={16} />,
        run: () => void newConversation(),
      },
      {
        section: "Actions",
        label: "Toggle sidebar",
        icon: <PanelLeft size={16} />,
        run: toggleSidebar,
      },
      {
        section: "Actions",
        label: "Open Settings",
        icon: <Settings size={16} />,
        run: () => setSettingsPage("general"),
      },
      {
        section: "Actions",
        label: "Open Global memory",
        icon: <Database size={16} />,
        run: () => setSettingsPage("memory"),
      },
      ...conversations.map((c) => ({
        section: "Chats" as const,
        label: c.title,
        icon: <MessageSquare size={16} />,
        run: () => void selectConversation(c.id).catch(() => undefined),
      })),
      ...projects.map((p) => ({
        section: "Projects" as const,
        label: p.name,
        icon: <Folder size={16} />,
        run: () => selectProject(p.id),
      })),
    ];
  }, [conversations, projects, selectConversation, selectProject, newConversation, toggleSidebar, setSettingsPage]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return entries.filter((e) => !q || e.label.toLowerCase().includes(q));
  }, [entries, query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setIndex(0);
    setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const entry = filtered[index];
        if (entry) {
          setPaletteOpen(false);
          onClose();
          setTimeout(entry.run, 0);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, filtered, index, onClose, setPaletteOpen]);

  useEffect(() => {
    document
      .querySelector("#palette-list .selected")
      ?.scrollIntoView({ block: "nearest" });
  }, [index ]);

  if (!open) return null;

  let section = "";
  return (
    <div
      className="fixed inset-0 z-[100] bg-black/40 px-4 pt-[12vh]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="mx-auto w-[560px] max-w-full overflow-hidden rounded-composer border border-border bg-surface shadow-[var(--shadow)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex h-12 items-center gap-2.5 border-b border-border px-3.5">
          <Search size={16} className="text-muted" aria-hidden="true" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats, projects, actions…"
            aria-label="Command palette"
            autoComplete="off"
            className="flex-1 border-0 bg-transparent text-[15px] outline-none placeholder:text-muted"
          />
        </div>
        <div id="palette-list" className="max-h-[50vh] overflow-auto p-1.5">
          {filtered.map((entry, i) => {
            const header = entry.section !== section ? entry.section : null;
            section = entry.section;
            return (
              <div key={`${entry.section}-${entry.label}-${i}`}>
                {header && (
                  <div className="px-2.5 pb-0.5 pt-1.5 text-[11px] uppercase text-muted">
                    {header}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setPaletteOpen(false);
                    onClose();
                    setTimeout(entry.run, 0);
                  }}
                  className={cn(
                    "flex h-9 w-full items-center gap-2.5 rounded-control px-2.5 text-left text-sm",
                    i === index && "selected bg-active",
                  )}
                >
                  <span className="text-muted">{entry.icon}</span>
                  <span className="truncate">{entry.label}</span>
                </button>
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-muted">No results</div>
          )}
        </div>
        <div className="border-t border-border px-3.5 py-2 text-xs text-muted">
          ↑↓ navigate · Enter select · Esc close
        </div>
      </div>
    </div>
  );
}
