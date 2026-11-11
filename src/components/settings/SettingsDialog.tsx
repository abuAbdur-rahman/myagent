import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BookOpen,
  Box,
  Brain,
  Cpu,
  Database,
  Globe,
  Info,
  Keyboard,
  History,
  Mic,
  Monitor,
  Palette,
  Plug,
  Settings as SettingsIcon,
  ShieldCheck,
  X,
  Blocks,
} from "lucide-react";
import { useApp } from "../../lib/store";
import { ProvidersPage } from "./ProvidersPage";
import { ChangelogPage } from "./ChangelogPage";
import { SandboxPage } from "./SandboxPage";
import { SkillsPage } from "./SkillsPage";
import { VoicePage } from "./VoicePage";
import {
  AboutPage,
  AppearancePage,
  AuditPage,
  ComputerUsePage,
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
import {
  resolveSettingsPage,
  SETTINGS_PAGES,
  SETTINGS_SUBTITLES,
  type SettingsPageId,
} from "../../lib/settings-pages";
import { useFocusTrap } from "../../lib/useFocusTrap";

const ICONS: Record<SettingsPageId, ReactNode> = {
  general: <SettingsIcon size={16} />,
  appearance: <Palette size={16} />,
  providers: <Plug size={16} />,
  models: <Cpu size={16} />,
  search: <Globe size={16} />,
  mcp: <Blocks size={16} />,
  computer: <Monitor size={16} />,
  sandbox: <Box size={16} />,
  skills: <BookOpen size={16} />,
  voice: <Mic size={16} />,
  audit: <ShieldCheck size={16} />,
  memory: <Brain size={16} />,
  data: <Database size={16} />,
  shortcuts: <Keyboard size={16} />,
  changelog: <History size={16} />,
  about: <Info size={16} />,
};

const PAGES = SETTINGS_PAGES.map((page) => ({ ...page, icon: ICONS[page.id] }));

const TITLES: Record<string, string> = Object.fromEntries(PAGES.map((p) => [p.id, p.label]));

const SUBTITLES = SETTINGS_SUBTITLES;

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

  const page = resolveSettingsPage(settingsPage);
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
      className="fixed inset-0 z-[100] grid place-items-center bg-[var(--scrim)] px-4 py-6 backdrop-blur-[3px]"
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
        className="flex h-[min(800px,92dvh)] w-[min(1200px,96vw)] overflow-hidden rounded-composer bg-raised shadow-[var(--shadow-lg)] ring-1 ring-line-strong"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <nav
          className="flex w-[224px] flex-none flex-col overflow-y-auto border-r border-line-subtle bg-sunken px-3 pb-8 pt-5"
          aria-label="Settings sections"
        >
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search settings"
            aria-label="Search settings"
            autoComplete="off"
            className="mb-4 h-8 w-full flex-none rounded-field bg-fill-1 px-2.5 text-sm text-fg shadow-[inset_0_0_0_1px_var(--line)] outline-none placeholder:text-fg-3 focus:shadow-[inset_0_0_0_1px_var(--accent-line),0_0_0_3px_var(--accent-ring)]"
          />
          <div className="flex flex-col gap-0.5">
            {navPages.map(({ id, label, icon }) => (
              <button
                key={id}
                type="button"
                onClick={() => openPage(id, null)}
                className={cn(
                  "flex h-8 items-center gap-2.5 rounded-field px-2.5 text-left text-sm text-fg-2 hover:bg-fill-2 hover:text-fg",
                  id === page && "bg-fill-3 font-medium text-fg",
                )}
              >
                <span className="text-fg-3">{icon}</span>
                {label}
              </button>
            ))}
            {q && navPages.length === 0 && hits.length === 0 && (
              <p className="px-2 py-2 text-xs text-fg-3">No matches</p>
            )}
          </div>
          {q && rowHits.length > 0 && (
            <div className="flex flex-col gap-0.5 border-t border-line-subtle pt-2">
              <p className="px-2.5 pb-1 text-xs font-medium text-fg-3">
                Settings
              </p>
              {rowHits.map((hit) => (
                <button
                  key={`${hit.page}-${hit.term}`}
                  type="button"
                  onClick={() => openPage(hit.page, hit.term)}
                  aria-label={`${hit.term} in ${hit.pageLabel}`}
                  className="flex h-8 items-center gap-2 rounded-field px-2.5 text-left text-sm text-fg-2 hover:bg-fill-2 hover:text-fg"
                >
                  <span className="min-w-0 truncate">{hit.term}</span>
                  <span className="ml-auto flex-none text-xs text-fg-3">{hit.pageLabel}</span>
                </button>
              ))}
            </div>
          )}
        </nav>
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="flex flex-none items-start gap-4 border-b border-line-subtle px-8 pb-4 pt-6">
            <div className="min-w-0 flex-1">
              <h2 className="text-[18px] font-semibold leading-snug">{TITLES[page]}</h2>
              <p className="mt-0.5 text-[13px] text-fg-3">{SUBTITLES[page]}</p>
            </div>
            <button
              type="button"
              aria-label="Close settings"
              onClick={() => setSettingsPage(null)}
              className="grid h-8 w-8 flex-none place-items-center rounded-field text-fg-2 hover:bg-fill-2 hover:text-fg"
            >
              <X size={16} />
            </button>
          </header>
          <section
            aria-label="Settings content"
            className="min-h-0 flex-1 overflow-y-auto px-8 py-6"
          >
            {page === "general" && <GeneralPage />}
            {page === "appearance" && <AppearancePage />}
            {page === "providers" && <ProvidersPage />}
            {page === "models" && <ModelsPage />}
            {page === "search" && <SearchPage />}
            {page === "mcp" && <McpPage />}
            {page === "computer" && <ComputerUsePage />}
            {page === "sandbox" && <SandboxPage />}
            {page === "skills" && <SkillsPage />}
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
    </div>
  );
}
