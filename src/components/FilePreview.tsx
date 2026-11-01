import { useEffect, useState } from "react";
import { ExternalLink, FileText } from "lucide-react";
import { openPath } from "@tauri-apps/plugin-opener";
import * as api from "../lib/api";
import { toast } from "../lib/toast";
import { errorText } from "../lib/utils";
import { Button, Spinner } from "./ui";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; preview: api.ArtifactPreview };

export function FilePreview({ path }: { path: string }) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let live = true;
    setState({ status: "loading" });
    api
      .artifactPreview(path)
      .then((preview) => {
        if (live) setState({ status: "ready", preview });
      })
      .catch((reason) => {
        if (live) setState({ status: "error", message: errorText(reason) });
      });
    return () => {
      live = false;
    };
  }, [path]);

  if (state.status === "loading") {
    return (
      <div className="flex flex-1 items-center gap-2 p-4 text-sm text-muted">
        <Spinner /> Converting a preview…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex flex-1 flex-col gap-2 p-4 text-sm">
        <p className="m-0 text-muted">{state.message}</p>
        <p className="m-0 text-xs text-muted">
          Office previews use the sandbox LibreOffice image. Enable or rebuild the sandbox, then
          reopen this file.
        </p>
      </div>
    );
  }

  const { preview } = state;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <span className="text-xs text-muted">
          {preview.images.length} page{preview.images.length === 1 ? "" : "s"} converted
        </span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            void Promise.resolve(openPath(preview.absolute)).catch((error) =>
              toast(errorText(error)),
            )
          }
        >
          <ExternalLink size={12} /> Open file
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-surface-2 p-3">
        <div className="mx-auto flex max-w-[900px] flex-col gap-3">
          {preview.images.map((image, index) => (
            <img
              key={index}
              src={image}
              alt={`Page ${index + 1}`}
              className="w-full rounded-card border border-border bg-white shadow-sm"
            />
          ))}
          {preview.text.trim() && (
            <details className="rounded-card border border-border bg-surface p-2 text-xs">
              <summary className="flex cursor-pointer items-center gap-1.5 text-muted">
                <FileText size={12} /> Extracted text
              </summary>
              <pre className="m-0 mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-muted">
                {preview.text}
              </pre>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
