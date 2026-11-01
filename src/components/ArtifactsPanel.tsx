import { useCallback, useEffect, useRef } from "react";
import {
  BookOpen,
  ChevronLeft,
  Code,
  Copy,
  Download,
  Eye,
  Maximize2,
  Minimize2,
  X,
} from "lucide-react";
import { useApp, type PanelMode, type PanelTab } from "../lib/store";
import { Markdown } from "./Markdown";
import { Badge } from "./ui";
import { SessionPanel } from "./SessionPanel";
import { FilePreview } from "./FilePreview";
import { cn, copyText, downloadText } from "../lib/utils";
import { toast } from "../lib/toast";

const EXTENSIONS: Record<string, string> = {
  html: "html",
  htm: "html",
  md: "md",
  markdown: "md",
  js: "js",
  jsx: "jsx",
  ts: "ts",
  tsx: "tsx",
  json: "json",
  py: "py",
  rs: "rs",
  css: "css",
  sql: "sql",
  yaml: "yaml",
  yml: "yaml",
  sh: "sh",
  bash: "sh",
};

function tabsFor(lang: string): { id: PanelTab; label: string }[] {
  const normalized = lang.toLowerCase();
  if (normalized === "html" || normalized === "htm") {
    return [
      { id: "preview", label: "Preview" },
      { id: "code", label: "Code" },
    ];
  }
  if (normalized === "md" || normalized === "markdown") {
    return [
      { id: "doc", label: "Doc" },
      { id: "source", label: "Source" },
    ];
  }
  if (["pdf", "docx", "pptx", "xlsx", "odt", "ods", "odp"].includes(normalized)) {
    return [{ id: "preview", label: "Preview" }];
  }
  return [{ id: "code", label: "Code" }];
}

export function ArtifactsPanel() {
  const {
    panelOpen,
    panelArtifact,
    panelTab,
    panelMode,
    panelView,
    panelWidth,
    setPanelTab,
    setPanelMode,
    setPanelWidth,
    showSessionView,
    closePanel,
  } = useApp();
  const dragState = useRef<{ startX: number; startWidth: number } | null>(null);

  const onDragMove = useCallback(
    (clientX: number) => {
      const state = dragState.current;
      if (!state) return;
      setPanelWidth(state.startWidth + (state.startX - clientX));
    },
    [setPanelWidth],
  );

  const endDrag = useCallback(() => {
    dragState.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", onPointerUp);
  }, []);

  const onPointerMove = useCallback(
    (e: PointerEvent) => onDragMove(e.clientX),
    [onDragMove],
  );
  const onPointerUp = useCallback(() => endDrag(), [endDrag]);

  const beginDrag = (e: { clientX: number; preventDefault: () => void }) => {
    e.preventDefault();
    dragState.current = { startX: e.clientX, startWidth: panelWidth };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
  };

  useEffect(() => endDrag, [endDrag]);

  if (!panelOpen) return null;

  if (panelView === "session" || !panelArtifact) {
    return <SessionPanel />;
  }

  const tabs = tabsFor(panelArtifact.lang);
  const activeTab = tabs.some((t) => t.id === panelTab) ? panelTab : tabs[0].id;
  const ext = EXTENSIONS[panelArtifact.lang.toLowerCase()] ?? "txt";

  const copy = async () => {
    toast((await copyText(panelArtifact.code)) ? "Copied" : "Copy failed");
  };

  const download = () => {
    downloadText(
      `artifact.${ext}`,
      panelArtifact.code,
      ext === "html" ? "text/html" : "text/plain",
    );
    toast("Artifact downloaded");
  };

  const width = panelMode === "mini" ? 300 : panelWidth;

  const toggleMode = (mode: PanelMode) => {
    setPanelMode(panelMode === mode ? "dock" : mode);
  };

  return (
    <section
      className="relative flex h-full shrink-0 flex-col overflow-hidden border-l border-border bg-surface"
      style={{ width: panelMode === "full" ? "100%" : width }}
    >
      {panelMode !== "full" && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize artifact panel"
          aria-valuemin={380}
          aria-valuemax={1000}
          aria-valuenow={panelWidth}
          tabIndex={0}
          title="Drag to resize"
          onPointerDown={beginDrag}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault();
              setPanelWidth(panelWidth + 20);
            } else if (event.key === "ArrowRight") {
              event.preventDefault();
              setPanelWidth(panelWidth - 20);
            } else if (event.key === "Home") {
              event.preventDefault();
              setPanelWidth(380);
            } else if (event.key === "End") {
              event.preventDefault();
              setPanelWidth(1000);
            }
          }}
          className="absolute inset-y-0 left-0 z-10 w-2 -translate-x-1/2 cursor-ew-resize touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        />
      )}
      <div className="flex h-12 flex-none items-center gap-2 px-2 pl-3.5">
        <button
          type="button"
          aria-label="Back to progress"
          title="Progress"
          onClick={showSessionView}
          className="grid h-7 w-7 flex-none place-items-center rounded-control text-muted hover:bg-hover hover:text-text"
        >
          <ChevronLeft size={16} />
        </button>
        <b className="truncate text-sm" title={panelArtifact.title}>
          {panelArtifact.title}
        </b>
        <Badge>{panelArtifact.lang}</Badge>
        <div className="ml-2 flex gap-0.5">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setPanelTab(tab.id)}
              className={cn(
                "rounded-control px-2.5 py-1 text-[13px]",
                activeTab === tab.id ? "bg-active text-text" : "text-muted hover:text-text",
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        {!panelArtifact.path && (
          <>
            <button
              type="button"
              aria-label="Copy artifact"
              title="Copy"
              onClick={() => void copy()}
              className="grid h-8 w-8 place-items-center rounded-control text-muted hover:bg-hover hover:text-text"
            >
              <Copy size={16} />
            </button>
            <button
              type="button"
              aria-label="Download artifact"
              title="Download"
              onClick={download}
              className="grid h-8 w-8 place-items-center rounded-control text-muted hover:bg-hover hover:text-text"
            >
              <Download size={16} />
            </button>
          </>
        )}
        <button
          type="button"
          aria-label={panelMode === "mini" ? "Restore panel size" : "Minimize panel"}
          title={panelMode === "mini" ? "Restore" : "Minimize"}
          onClick={() => toggleMode("mini")}
          className="grid h-8 w-8 place-items-center rounded-control text-muted hover:bg-hover hover:text-text"
        >
          <Minimize2 size={16} />
        </button>
        <button
          type="button"
          aria-label={panelMode === "full" ? "Exit fullscreen" : "Fullscreen panel"}
          title={panelMode === "full" ? "Exit fullscreen" : "Fullscreen"}
          onClick={() => toggleMode("full")}
          className="grid h-8 w-8 place-items-center rounded-control text-muted hover:bg-hover hover:text-text"
        >
          <Maximize2 size={16} />
        </button>
        <button
          type="button"
          aria-label="Close panel"
          title="Close"
          onClick={closePanel}
          className="grid h-8 w-8 place-items-center rounded-control text-muted hover:bg-hover hover:text-text"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeTab === "preview" && panelArtifact.path && (
          <FilePreview path={panelArtifact.path} />
        )}
        {activeTab === "preview" && !panelArtifact.path && (
          <iframe
            sandbox="allow-scripts"
            srcDoc={panelArtifact.code}
            title="Artifact preview"
            className="h-full w-full flex-1 border-0 bg-white"
          />
        )}
        {activeTab === "doc" && (
          <div className="flex-1 overflow-auto px-6 py-5">
            <Markdown content={panelArtifact.code} />
          </div>
        )}
        {activeTab !== "preview" && activeTab !== "doc" && (
          <pre className="m-0 flex-1 overflow-auto p-3.5 font-mono text-[13px] leading-relaxed">
            <code>{panelArtifact.code}</code>
          </pre>
        )}
      </div>

      <div className="flex-none border-t border-border px-3.5 py-2 text-xs text-muted">
        {activeTab === "preview" && (
          <span className="inline-flex items-center gap-1.5">
            <Eye size={12} /> {panelArtifact.path ? "Converted in the sandbox" : "Sandboxed preview"}
          </span>
        )}
        {activeTab === "doc" && (
          <span className="inline-flex items-center gap-1.5">
            <BookOpen size={12} /> Rendered document
          </span>
        )}
        {activeTab !== "preview" && activeTab !== "doc" && (
          <span className="inline-flex items-center gap-1.5">
            <Code size={12} /> Source view
          </span>
        )}
      </div>
    </section>
  );
}
