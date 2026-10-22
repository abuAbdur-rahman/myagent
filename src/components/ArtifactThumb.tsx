import { FileText } from "lucide-react";

import { stripActiveContent } from "../lib/thumb";

export interface ThumbArtifact {
  title: string;
  lang: string;
  code: string;
}

function isHtml(lang: string): boolean {
  const normalized = lang.toLowerCase();
  return normalized === "html" || normalized === "htm";
}

function isDoc(lang: string): boolean {
  const normalized = lang.toLowerCase();
  return normalized === "md" || normalized === "markdown";
}

export function ArtifactThumb({ artifact }: { artifact: ThumbArtifact }) {
  if (isHtml(artifact.lang)) {
    return (
      <div
        className="relative h-[104px] w-full overflow-hidden rounded-control border border-border bg-white"
        aria-hidden="true"
      >
        <iframe
          sandbox=""
          tabIndex={-1}
          title=""
          srcDoc={stripActiveContent(artifact.code)}
          className="pointer-events-none origin-top-left border-0"
          style={{ width: "400%", height: "400%", transform: "scale(0.25)" }}
        />
      </div>
    );
  }

  if (isDoc(artifact.lang)) {
    return (
      <div
        className="flex h-[104px] w-full flex-col gap-1.5 overflow-hidden rounded-control border border-border bg-surface p-2"
        aria-hidden="true"
      >
        <span className="h-2 w-2/3 rounded bg-border" />
        <span className="h-1.5 w-full rounded bg-border/70" />
        <span className="h-1.5 w-11/12 rounded bg-border/70" />
        <span className="h-1.5 w-4/5 rounded bg-border/70" />
        <span className="h-2 w-1/2 rounded bg-border" />
      </div>
    );
  }

  return (
    <div
      className="flex h-[104px] w-full items-center justify-center gap-1.5 rounded-control border border-border bg-surface text-xs text-muted"
      aria-hidden="true"
    >
      <FileText size={16} />
      {artifact.lang || "text"}
    </div>
  );
}
