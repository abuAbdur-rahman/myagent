import { useCallback, useEffect, useRef } from "react";
import {
  Archive,
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
import { save } from "@tauri-apps/plugin-dialog";
import { useApp, type PanelMode, type PanelTab } from "../lib/store";
import * as api from "../lib/api";
import { Markdown } from "./Markdown";
import { Badge, Segmented } from "./ui";
import { SessionPanel } from "./SessionPanel";
import { FilePreview } from "./FilePreview";
import { ContextInspector } from "./ContextInspector";
import { copyText, downloadText, errorText } from "../lib/utils";
import { toast } from "../lib/toast";
import { ArtifactPreview } from "./ArtifactPreview";

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

function fileStem(title: string, ext: string): string {
  const cleaned = title
    .replace(new RegExp(`\\.${ext}$`, "i"), "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80)
    .replace(/[. ]+$/g, "");
  const name = cleaned || "artifact";
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(name) ? `${name}-artifact` : name;
}

const MAX_ZIP_VERSIONS = 64;
const MAX_ZIP_ENTRY_BYTES = 2 * 1024 * 1024;
const MAX_ZIP_BYTES = 16 * 1024 * 1024;

function bytesOf(text: string): number {
  return new TextEncoder().encode(text).length;
}

function zipLimitProblem(versions: { code: string }[]): string | null {
  if (versions.length > MAX_ZIP_VERSIONS) {
    return `A zip holds up to ${MAX_ZIP_VERSIONS} versions. Save an earlier one on its own first.`;
  }
  const sizes = versions.map((version) => bytesOf(version.code));
  if (sizes.some((size) => size > MAX_ZIP_ENTRY_BYTES)) {
    return "One version is over 2 MB, so it cannot go in a zip. Download it on its own.";
  }
  if (sizes.reduce((total, size) => total + size, 0) > MAX_ZIP_BYTES) {
    return "These versions are over 16 MB together, so they cannot go in one zip.";
  }
  return null;
}

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
    panelArtifactVersions,
    panelTab,
    panelMode,
    panelView,
    panelWidth,
    setPanelTab,
    setPanelMode,
    setPanelWidth,
    showSessionView,
    closePanel,
    openArtifact,
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

  if (panelView === "context") {
    return <ContextInspector />;
  }

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
      `${fileStem(panelArtifact.title, ext)}.${ext}`,
      panelArtifact.code,
      ext === "html" ? "text/html" : "text/plain",
    );
    toast("Artifact downloaded");
  };

  const downloadVersions = async () => {
    const limit = zipLimitProblem(panelArtifactVersions);
    if (limit) {
      toast(limit);
      return;
    }
    try {
      const destination = await save({
        defaultPath: `${fileStem(panelArtifact.title, ext)}-versions.zip`,
        filters: [{ name: "Zip archive", extensions: ["zip"] }],
      });
      if (!destination) return;
      await api.artifactZipExport(
        destination,
        panelArtifactVersions.map((version) => {
          const versionExt = EXTENSIONS[version.lang.toLowerCase()] ?? "txt";
          return {
            name: `${String(version.index).padStart(2, "0")}-${fileStem(version.title, versionExt)}.${versionExt}`,
            content: version.code,
          };
        }),
      );
      toast("Artifact versions downloaded");
    } catch (error) {
      toast(errorText(error));
    }
  };

  const width = panelMode === "mini" ? 300 : panelWidth;

  const toggleMode = (mode: PanelMode) => {
    setPanelMode(panelMode === mode ? "dock" : mode);
  };

  return (
    <section
      className="relative flex h-full shrink-0 flex-col overflow-hidden bg-canvas shadow-[inset_1px_0_0_var(--line)]"
      style={{ width: panelMode === "full" ? "100%" : width }}
    >
      {panelMode !== "full" && (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize artifact panel"
          aria-valuemin={360}
          aria-valuemax={640}
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
              setPanelWidth(360);
            } else if (event.key === "End") {
              event.preventDefault();
              setPanelWidth(640);
            }
          }}
          className="absolute inset-y-0 left-0 z-10 w-2 -translate-x-1/2 cursor-ew-resize touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-line"
        />
      )}
      <div className="flex h-12 flex-none items-center gap-2 border-b border-line-subtle px-2 pl-3">
        <button
          type="button"
          aria-label="Back to progress"
          title="Progress"
          onClick={showSessionView}
          className="grid h-7 w-7 flex-none place-items-center rounded-field text-fg-2 hover:bg-fill-2 hover:text-fg"
        >
          <ChevronLeft size={16} />
        </button>
        <b className="min-w-0 truncate text-sm font-semibold" title={panelArtifact.title}>
          {panelArtifact.title}
        </b>
        <Badge>{panelArtifact.lang}</Badge>
        <span className="flex-1" />
        <button
          type="button"
          aria-label="Close panel"
          title="Close"
          onClick={closePanel}
          className="grid h-7 w-7 place-items-center rounded-field text-fg-2 hover:bg-fill-2 hover:text-fg"
        >
          <X size={16} />
        </button>
      </div>

      <div className="flex h-11 flex-none items-center gap-2 border-b border-line-subtle px-3">
        <Segmented
          value={activeTab}
          options={tabs.map((tab) => ({ value: tab.id, label: tab.label }))}
          onChange={(value) => setPanelTab(value)}
          label="Artifact view"
        />
        <span className="flex-1" />
        {!panelArtifact.path && (
          <>
            <button
              type="button"
              aria-label="Copy artifact"
              title="Copy"
              onClick={() => void copy()}
              className="grid h-7 w-7 place-items-center rounded-field text-fg-2 hover:bg-fill-2 hover:text-fg"
            >
              <Copy size={15} />
            </button>
            <button
              type="button"
              aria-label="Download artifact"
              title="Download"
              onClick={download}
              className="grid h-7 w-7 place-items-center rounded-field text-fg-2 hover:bg-fill-2 hover:text-fg"
            >
              <Download size={15} />
            </button>
            {panelArtifactVersions.length > 1 && (
              <button
                type="button"
                aria-label="Download all artifact versions"
                title="Download all versions"
                onClick={() => void downloadVersions()}
                className="grid h-7 w-7 place-items-center rounded-field text-fg-2 hover:bg-fill-2 hover:text-fg"
              >
                <Archive size={15} />
              </button>
            )}
          </>
        )}
        <span className="mx-1 h-4 w-px bg-line-subtle" aria-hidden="true" />
        <button
          type="button"
          aria-label={panelMode === "mini" ? "Restore panel size" : "Minimize panel"}
          title={panelMode === "mini" ? "Restore" : "Minimize"}
          onClick={() => toggleMode("mini")}
          className="grid h-7 w-7 place-items-center rounded-field text-fg-2 hover:bg-fill-2 hover:text-fg"
        >
          <Minimize2 size={15} />
        </button>
        <button
          type="button"
          aria-label={panelMode === "full" ? "Exit fullscreen" : "Fullscreen panel"}
          title={panelMode === "full" ? "Exit fullscreen" : "Fullscreen"}
          onClick={() => toggleMode("full")}
          className="grid h-7 w-7 place-items-center rounded-field text-fg-2 hover:bg-fill-2 hover:text-fg"
        >
          <Maximize2 size={15} />
        </button>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {activeTab === "preview" && panelArtifact.path && (
          <FilePreview path={panelArtifact.path} />
        )}
        {activeTab === "preview" && !panelArtifact.path && (
          <ArtifactPreview
            code={panelArtifact.code}
            onShowSource={() => setPanelTab("code")}
          />
        )}
        {activeTab === "doc" && (
          <div className="flex-1 overflow-auto px-6 py-5">
            <Markdown content={panelArtifact.code} />
          </div>
        )}
        {activeTab !== "preview" && activeTab !== "doc" && (
          <pre className="m-0 flex-1 overflow-auto bg-code p-3.5 font-mono text-[13px] leading-relaxed">
            <code>{panelArtifact.code}</code>
          </pre>
        )}
      </div>

      <div className="flex h-8 flex-none items-center gap-1.5 border-t border-line-subtle px-3 text-xs text-fg-3">
        {activeTab === "preview" && (
          <span className="inline-flex items-center gap-1.5">
            <Eye size={12} /> {panelArtifact.path ? "Converted in the sandbox" : "Sandboxed preview · scripts and CDN assets allowed"}
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
        {panelArtifactVersions.length > 1 && (
          <select
            value={panelArtifact.id}
            onChange={(event) => {
              const version = panelArtifactVersions.find((item) => item.id === event.target.value);
              if (version) openArtifact(version);
            }}
            aria-label="Artifact version"
            className="ml-auto h-6 max-w-28 rounded-field bg-fill-1 px-1.5 text-[11px] text-fg shadow-[inset_0_0_0_1px_var(--line)] outline-none focus:shadow-[inset_0_0_0_1px_var(--accent-line),0_0_0_3px_var(--accent-ring)]"
          >
            {panelArtifactVersions.map((version) => (
              <option key={version.id} value={version.id}>
                Version {version.index} of {version.total}
              </option>
            ))}
          </select>
        )}
      </div>
    </section>
  );
}
