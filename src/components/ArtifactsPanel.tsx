import { Code, Copy, Download, Eye, X } from "lucide-react";
import { useApp, type PanelTab } from "../lib/store";
import { Markdown } from "./Markdown";
import { Badge } from "./ui";
import { copyText, downloadText } from "../lib/utils";
import { toast } from "../lib/toast";
import { cn } from "../lib/utils";

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
  return [{ id: "code", label: "Code" }];
}

export function ArtifactsPanel() {
  const { panelOpen, panelArtifact, panelTab, setPanelTab, closePanel } = useApp();

  if (!panelOpen || !panelArtifact) return null;

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

  return (
    <section className="flex h-full w-[420px] shrink-0 flex-col overflow-hidden border-l border-border bg-surface">
      <div className="flex h-12 flex-none items-center gap-2 px-2 pl-3.5">
        <b className="truncate text-sm">Artifact</b>
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
        {activeTab === "preview" ? (
          <iframe
            sandbox="allow-scripts"
            srcDoc={panelArtifact.code}
            title="Artifact preview"
            className="h-full w-full flex-1 border-0 bg-white"
          />
        ) : activeTab === "doc" ? (
          <div className="flex-1 overflow-auto px-6 py-5">
            <Markdown content={panelArtifact.code} />
          </div>
        ) : (
          <pre className="m-0 flex-1 overflow-auto p-3.5 font-mono text-[13px] leading-relaxed">
            <code>{panelArtifact.code}</code>
          </pre>
        )}
      </div>

      <div className="flex-none border-t border-border px-3.5 py-2 text-xs text-muted">
        {activeTab === "preview" ? (
          <span className="inline-flex items-center gap-1.5">
            <Eye size={12} /> Sandboxed preview
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5">
            <Code size={12} /> Source view
          </span>
        )}
      </div>
    </section>
  );
}
