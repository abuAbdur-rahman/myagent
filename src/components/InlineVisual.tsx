import { useCallback, useEffect, useRef, useState } from "react";

import * as api from "../lib/api";
import { useThemeName } from "../lib/useThemeName";
import { errorText } from "../lib/utils";

type State =
  | { status: "loading" }
  | { status: "ready"; url: string }
  | { status: "error"; message: string };

function themeTokens(): Record<string, string> {
  const style = getComputedStyle(document.documentElement);
  const read = (name: string) => style.getPropertyValue(name).trim();
  return {
    "--myagent-bg": read("--background"),
    "--myagent-fg": read("--foreground"),
    "--myagent-muted": read("--muted-foreground"),
    "--myagent-border": read("--border"),
    "--myagent-accent": read("--primary"),
    "--myagent-card": read("--card"),
    "--myagent-radius": read("--radius"),
  };
}

export function InlineVisual({ code, isStreaming }: { code: string; isStreaming: boolean }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [height, setHeight] = useState(360);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const themeName = useThemeName();

  useEffect(() => {
    if (isStreaming) return;
    let live = true;
    let created: string | null = null;
    setState({ status: "loading" });
    setHeight(360);
    api
      .artifactInlineUrl(code)
      .then((handle) => {
        if (!live) {
          void api
            .artifactPreviewDrop(handle.id)
            .catch((error: unknown) => console.warn("Inline visual cleanup failed", error));
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
          .catch((error: unknown) => console.warn("Inline visual cleanup failed", error));
      }
    };
  }, [code, isStreaming]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      const data = event.data as { type?: unknown; height?: unknown } | null;
      if (!data || data.type !== "myagent:height") return;
      const value = Number(data.height);
      if (!Number.isFinite(value)) return;
      setHeight(Math.max(120, Math.min(2000, Math.round(value))));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const sendTheme = useCallback(() => {
    frameRef.current?.contentWindow?.postMessage(
      { type: "myagent:theme", tokens: themeTokens() },
      "*",
    );
  }, []);

  useEffect(() => {
    if (state.status === "ready") sendTheme();
  }, [state.status, themeName, sendTheme]);

  if (isStreaming) {
    return (
      <div
        className="my-3 flex items-center gap-2 rounded-panel border border-border bg-surface-2 px-3 py-2 text-xs text-muted"
        role="status"
      >
        Building an interactive visual…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="my-3 overflow-hidden rounded-panel border border-border bg-surface-2">
        <div className="border-b border-border px-3 py-1.5 text-xs text-muted">
          {state.message}
        </div>
        <pre className="m-0 max-h-80 overflow-auto p-3 font-mono text-xs leading-relaxed">
          <code>{code}</code>
        </pre>
      </div>
    );
  }

  if (state.status === "loading") {
    return (
      <div
        className="my-3 rounded-panel border border-border bg-surface-2 px-3 py-2 text-xs text-muted"
        role="status"
      >
        Preparing a sandboxed visual…
      </div>
    );
  }

  return (
    <div className="my-3 overflow-hidden rounded-panel border border-border" role="group" aria-label="Interactive visual">
      <iframe
        ref={frameRef}
        sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads"
        src={state.url}
        title="Interactive visual"
        referrerPolicy="no-referrer"
        allow="camera 'none'; microphone 'none'; geolocation 'none'; display-capture 'none'"
        onLoad={sendTheme}
        style={{ height, backgroundColor: "transparent" }}
        className="block w-full border-0"
      />
    </div>
  );
}
