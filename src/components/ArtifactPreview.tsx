import { useEffect, useState } from "react";

import * as api from "../lib/api";
import { errorText } from "../lib/utils";
import { Button, Spinner } from "./ui";

type State =
  | { status: "loading" }
  | { status: "ready"; url: string }
  | { status: "error"; message: string };

export function ArtifactPreview({
  code,
  onShowSource,
}: {
  code: string;
  onShowSource: () => void;
}) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let live = true;
    let created: string | null = null;
    setState({ status: "loading" });
    api
      .artifactPreviewUrl(code)
      .then((handle) => {
        if (!live) {
          void api
            .artifactPreviewDrop(handle.id)
            .catch((error: unknown) => console.warn("Artifact preview cleanup failed", error));
          return;
        }
        created = handle.id;
        setState({ status: "ready", url: handle.url });
      })
      .catch((reason) => {
        if (live) setState({ status: "error", message: errorText(reason) });
      });
    return () => {
      live = false;
      if (created) {
        void api
          .artifactPreviewDrop(created)
          .catch((error: unknown) => console.warn("Artifact preview cleanup failed", error));
      }
    };
  }, [code]);

  if (state.status === "loading") {
    return (
      <div className="flex flex-1 items-center gap-2 p-4 text-sm text-muted">
        <Spinner /> Preparing a sandboxed preview.
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex flex-1 flex-col items-start gap-2 p-4 text-sm">
        <p className="m-0 text-muted">{state.message}</p>
        <Button size="sm" variant="ghost" onClick={onShowSource}>
          View code
        </Button>
      </div>
    );
  }

  return (
    <iframe
      sandbox="allow-scripts"
      src={state.url}
      title="Artifact preview"
      referrerPolicy="no-referrer"
      allow="camera 'none'; microphone 'none'; geolocation 'none'"
      className="h-full w-full flex-1 border-0 bg-white"
    />
  );
}
