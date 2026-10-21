import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Brain,
  Cpu,
  Database,
  Info,
  Keyboard,
  History,
  Mic,
  Palette,
  Plug,
  Search,
  Settings as SettingsIcon,
  Shield,
  Sparkles,
  X,
  Blocks,
} from "lucide-react";
import { useApp } from "../../lib/store";
import { ProvidersPage } from "./ProvidersPage";
import { ChangelogPage } from "./ChangelogPage";
import { SandboxPage } from "./SandboxPage";
import { VoicePage } from "./VoicePage";
import {
  AboutPage,
  AppearancePage,
  AuditPage,
  DataPage,
  GeneralPage,
  McpPage,
  MemoryPage,
  ModelsPage,
  SearchPage,
  ShortcutsPage,
} from "./SimplePages";
import { cn } from "../../lib/utils";
import { hitKey, searchSettings } from "../../lib/settings-search";
import { SETTINGS_INDEX } from "../../lib/settings-index";
import { useFocusTrap } from "../../lib/useFocusTrap";

const PAGES = [
  { id: "general", label: "General", icon: <SettingsIcon size={16} /> },
  { id: "appearance", label: "Appearance", icon: <Palette size={16} /> },
  { id: "providers", label: "Providers", icon: <Plug size={16} /> },
  { id: "models", label: "Models", icon: <Cpu size={16} /> },
  { id: "search", label: "Search", icon: <Search size={16} /> },
  { id: "mcp", label: "MCP", icon: <Blocks size={16} /> },
  { id: "sandbox", label: "Sandbox", icon: <Shield size={16} /> },
  { id: "voice", label: "Voice", icon: <Mic size={16} /> },
  { id: "audit", label: "Audit", icon: <History size={16} /> },
  { id: "memory", label: "Memory", icon: <Brain size={16} /> },
  { id: "data", label: "Data", icon: <Database size={16} /> },
  { id: "shortcuts", label: "Shortcuts", icon: <Keyboard size={16} /> },
  { id: "changelog", label: "Changelog", icon: <Sparkles size={16} /> },
  { id: "about", label: "About", icon: <Info size={16} /> },
];

const TITLES: Record<string, string> = Object.fromEntries(PAGES.map((p) => [p.id, p.label]));

const SUBTITLES: Record<string, string> = {
  general: "How a chat starts, and how much context is sent with every message.",
  appearance: "Theme, accent color, and how dense the interface feels.",
  providers: "API keys and base URLs. Keys stay in Windows Credential Manager.",
  models: "What the active model can do, and which model answers first.",
  search: "Where web results come from, and which keys get spent.",
  mcp: "External tool servers, and what each tool may do without asking.",
  sandbox: "Run commands in Docker instead of the host shell.",
  voice: "Microphone, transcription model, and where the audio goes.",
  audit: "Every tool decision, newest first, with the reason behind it.",
  memory: "Notes sent with every chat. Global lives here, project memory lives with the project.",
  data: "What this app has stored, and how to take it or remove it.",
  shortcuts: "Keys that work anywhere in the app.",
  changelog: "Every release, newest first.",
  about: "Version, updates, and where the source lives.",
};

const SETTLE_MS = 180;
const HIGHLIGHT_TRIES = 12;
const HIGHLIGHT_TICK_MS = 100;
const HIGHLIGHT_MS = 1600;

export function SettingsDialog() {
  const { settingsPage, setSettingsPage } = useApp();
  const [search, setSearch] = useState("");
  const [jump, setJump] = useState<{ page: string; term: string | null; key: string } | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const lastJump = useRef("");
  const wasOpen = useRef(false);

  const close = useCallback(() => setSettingsPage(null), [setSettingsPage]);
  useFocusTrap(panelRef, settingsPage !== null, close);

  useEffect(() => {
    if (settingsPage !== null && !wasOpen.current) {
      setSearch("");
      setJump(null);
      lastJump.current = "";
    }
    wasOpen.current = settingsPage !== null;
  }, [settingsPage]);

  const page = settingsPage !== null && PAGES.some((p) => p.id === settingsPage) ? settingsPage : "general";
  const q = search.trim().toLowerCase();
  const hits = useMemo(() => searchSettings(PAGES, SETTINGS_INDEX, search), [search]);
  const rowHits = hits.filter((hit) => hit.term !== null);
  const visiblePages = hits.filter((hit) => hit.term === null).map((hit) => hit.page);
  const navPages = q
    ? PAGES.filter((candidate) => visiblePages.includes(candidate.id))
    : PAGES;
  const first = hits[0];
  const firstKey = hitKey(first);

  useEffect(() => {
    if (!first || !firstKey) return;
    if (lastJump.current === firstKey) return;
    const timer = window.setTimeout(() => {
      if (lastJump.current === firstKey) return;
      lastJump.current = firstKey;
      setSettingsPage(first.page);
      setJump({ page: first.page, term: first.term, key: firstKey });
    }, SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [first, firstKey, setSettingsPage]);

  useEffect(() => {
    if (q) return;
    lastJump.current = "";
    setJump(null);
  }, [q]);

  useEffect(() => {
    if (!jump || !jump.term || jump.page !== page) return;
    const term = jump.term.toLowerCase();
    let tries = 0;
    let poll = 0;
    let flash = 0;
    const reveal = () => {
      const nodes = panelRef.current?.querySelectorAll<HTMLElement>("[data-setting-term]");
      const target = Array.from(nodes ?? []).find((node) =>
        (node.dataset.settingTerm ?? "").toLowerCase().includes(term),
      );
      if (!target) {
        if (tries++ < HIGHLIGHT_TRIES) poll = window.setTimeout(reveal, HIGHLIGHT_TICK_MS);
        return;
      }
      target.scrollIntoView({ block: "center" });
      target.classList.add("settings-hit");
      flash = window.setTimeout(() => target.classList.remove("settings-hit"), HIGHLIGHT_MS);
    };
    reveal();
    return () => {
      window.clearTimeout(poll);
      window.clearTimeout(flash);
    };
  }, [jump, page]);

  if (settingsPage === null) return null;

  const openPage = (id: string, term: string | null) => {
    setSettingsPage(id);
    if (!term) {
      setJump(null);
      return;
    }
    const key = `${id}\u0000${term}`;
    lastJump.current = key;
    setJump({ page: id, term, key });
  };

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
        <nav
          className="flex w-[220px] flex-none flex-col gap-2 overflow-y-auto border-r border-border bg-surface-2 p-3"
          aria-label="Settings sections"
        >
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search settings"
            aria-label="Search settings"
            autoComplete="off"
            className="h-8 w-full rounded-card border border-border bg-surface px-2.5 text-sm outline-none placeholder:text-muted focus:border-accent"
          />
          <div className="flex flex-col gap-0.5">
            {navPages.map(({ id, label, icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => openPage(id, null)}
                className={cn(
                  "flex h-[34px] items-center gap-2.5 rounded-control px-2.5 text-left text-sm",
                  id === page ? "bg-active font-semibold" : "hover:bg-hover",
                )}
              >
                <span className="text-muted">{icon}</span>
                {label}
              </button>
            ))}
            {q && navPages.length === 0 && hits.length === 0 && (
              <p className="px-2 py-2 text-xs text-muted">No matches</p>
            )}
          </div>
          {q && rowHits.length > 0 && (
            <div className="flex flex-col gap-0.5 border-t border-border pt-2">
              <p className="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted">
                Settings
              </p>
              {rowHits.map((hit) => (
                <button
                  key={`${hit.page}-${hit.term}`}
                  type="button"
                  onClick={() => openPage(hit.page, hit.term)}
                  aria-label={`${hit.term} in ${hit.pageLabel}`}
                  className="flex h-[30px] items-center gap-2 rounded-control px-2.5 text-left text-sm hover:bg-hover"
                >
                  <span className="min-w-0 truncate">{hit.term}</span>
                  <span className="ml-auto flex-none text-[11px] text-muted">{hit.pageLabel}</span>
                </button>
              ))}
            </div>
          )}
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
          <header className="mb-4 mt-0 pr-10">
            <h2 className="text-xl">{TITLES[page]}</h2>
            <p className="mt-1 text-sm text-muted">{SUBTITLES[page]}</p>
          </header>
          {page === "general" && <GeneralPage />}
          {page === "appearance" && <AppearancePage />}
          {page === "providers" && <ProvidersPage />}
          {page === "models" && <ModelsPage />}
          {page === "search" && <SearchPage />}
          {page === "mcp" && <McpPage />}
          {page === "sandbox" && <SandboxPage />}
          {page === "voice" && <VoicePage />}
          {page === "audit" && <AuditPage />}
          {page === "memory" && <MemoryPage />}
          {page === "data" && <DataPage />}
          {page === "shortcuts" && <ShortcutsPage />}
          {page === "changelog" && <ChangelogPage />}
          {page === "about" && <AboutPage />}
        </section>
      </div>
    </div>
  );
}
