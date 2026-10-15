import { useEffect, useRef, useState } from "react";
import {
  Brain,
  Cpu,
  Database,
  Info,
  Keyboard,
  Palette,
  Plug,
  Search,
  Settings as SettingsIcon,
  X,
} from "lucide-react";
import { useApp } from "../../lib/store";
import { ProvidersPage } from "./ProvidersPage";
import {
  AboutPage,
  AppearancePage,
  DataPage,
  GeneralPage,
  MemoryPage,
  ModelsPage,
  SearchPage,
  ShortcutsPage,
} from "./SimplePages";
import { cn } from "../../lib/utils";

const PAGES = [
  { id: "general", label: "General", icon: <SettingsIcon size={16} /> },
  { id: "appearance", label: "Appearance", icon: <Palette size={16} /> },
  { id: "providers", label: "Providers", icon: <Plug size={16} /> },
  { id: "models", label: "Models", icon: <Cpu size={16} /> },
  { id: "search", label: "Search", icon: <Search size={16} /> },
  { id: "memory", label: "Memory", icon: <Brain size={16} /> },
  { id: "data", label: "Data", icon: <Database size={16} /> },
  { id: "shortcuts", label: "Shortcuts", icon: <Keyboard size={16} /> },
  { id: "about", label: "About", icon: <Info size={16} /> },
];

const TITLES: Record<string, string> = Object.fromEntries(PAGES.map((p) => [p.id, p.label]));

export function SettingsDialog() {
  const { settingsPage, setSettingsPage } = useApp();
  const [search, setSearch] = useState("");
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (settingsPage === null) return;
    setSearch("");
    panelRef.current?.querySelector<HTMLElement>("input, button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSettingsPage(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [settingsPage, setSettingsPage]);

  if (settingsPage === null) return null;
  const page = PAGES.some((p) => p.id === settingsPage) ? settingsPage : "general";

  const q = search.toLowerCase();
  const visible = PAGES.filter(
    (p) => !q || p.label.toLowerCase().includes(q) || p.id.toLowerCase().includes(q),
  );

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-black/40 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) setSettingsPage(null);
      }}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        className="flex h-[min(640px,86vh)] w-[min(960px,92vw)] overflow-hidden rounded-composer border border-border bg-surface shadow-[var(--shadow)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <nav className="flex w-[220px] flex-none flex-col gap-2 overflow-y-auto border-r border-border bg-surface-2 p-3" aria-label="Settings sections">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search settings"
            aria-label="Search settings"
            autoComplete="off"
            className="h-8 w-full rounded-card border border-border bg-surface px-2.5 text-sm outline-none placeholder:text-muted focus:border-accent"
          />
          <div className="flex flex-col gap-0.5">
            {visible.map(({ id, label, icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => setSettingsPage(id)}
                className={cn(
                  "flex h-[34px] items-center gap-2.5 rounded-control px-2.5 text-left text-sm",
                  id === page ? "bg-active font-semibold" : "hover:bg-hover",
                )}
              >
                <span className="text-muted">{icon}</span>
                {label}
              </button>
            ))}
            {visible.length === 0 && <p className="px-2 py-2 text-xs text-muted">No matches</p>}
          </div>
        </nav>
        <section className="relative min-w-0 flex-1 overflow-y-auto p-6">
          <button
            type="button"
            aria-label="Close settings"
            onClick={() => setSettingsPage(null)}
            className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-control text-muted hover:bg-hover hover:text-text"
          >
            <X size={16} />
          </button>
          <h2 className="mb-4 mt-0 text-xl">{TITLES[page]}</h2>
          {page === "general" && <GeneralPage />}
          {page === "appearance" && <AppearancePage />}
          {page === "providers" && <ProvidersPage />}
          {page === "models" && <ModelsPage />}
          {page === "search" && <SearchPage />}
          {page === "memory" && <MemoryPage />}
          {page === "data" && <DataPage />}
          {page === "shortcuts" && <ShortcutsPage />}
          {page === "about" && <AboutPage />}
        </section>
      </div>
    </div>
  );
}
