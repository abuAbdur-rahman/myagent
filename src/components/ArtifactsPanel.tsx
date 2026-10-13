import { useState } from "react";
import type { Artifact } from "../lib/artifacts";
import { Button } from "./ui";

export function ArtifactsPanel({
  artifact,
  onClose,
}: {
  artifact: Artifact | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  if (!artifact) return null;

  const copy = async () => {
    await navigator.clipboard.writeText(artifact.code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <section className="flex h-full w-[420px] shrink-0 flex-col border-l border-neutral-800 bg-neutral-900/40">
      <header className="flex h-12 items-center justify-between border-b border-neutral-800 px-3">
        <span className="text-sm font-medium text-neutral-200">
          Artifact · {artifact.lang}
        </span>
        <div className="flex gap-1">
          <Button variant="ghost" size="sm" onClick={() => void copy()}>
            {copied ? "Copied" : "Copy"}
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close artifact">
            ✕
          </Button>
        </div>
      </header>
      <pre className="flex-1 overflow-auto p-4 text-xs leading-relaxed text-neutral-200">
        <code>{artifact.code}</code>
      </pre>
    </section>
  );
}
