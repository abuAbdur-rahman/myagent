import { useEffect, useState } from "react";
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
  const [copyFailed, setCopyFailed] = useState(false);

  useEffect(() => {
    setCopied(false);
    setCopyFailed(false);
  }, [artifact]);

  if (!artifact) return null;

  let copyLabel = "Copy";
  if (copied) copyLabel = "Copied";
  else if (copyFailed) copyLabel = "Copy failed";

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(artifact.code);
      setCopied(true);
      setCopyFailed(false);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopyFailed(true);
    }
  };

  return (
    <section className="flex h-full w-[420px] shrink-0 flex-col border-l border-vault-line bg-vault-surface/40">
      <header className="flex h-12 items-center justify-between border-b border-vault-line px-3">
        <span className="text-sm font-medium text-text-primary">
          Artifact · {artifact.lang}
        </span>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => void copy()}>
            {copyLabel}
          </Button>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close artifact">
            ✕
          </Button>
        </div>
      </header>
      <pre className="flex-1 overflow-auto bg-vault-raised p-4 text-xs leading-relaxed text-text-primary">
        <code>{artifact.code}</code>
      </pre>
    </section>
  );
}
