import { useEffect, useRef, useState } from "react";
import { Renderer, type ParseResult } from "@openuidev/react-lang";
import { openUrl } from "@tauri-apps/plugin-opener";

import { openuiLibrary } from "../../lib/openui/library";
import { toast } from "../../lib/toast";
import { useApp } from "../../lib/store";
import { errorText } from "../../lib/utils";

export function OpenUIRenderer({ code, isStreaming }: { code: string; isStreaming: boolean }) {
  const { sendMessage, streaming } = useApp();
  const [failed, setFailed] = useState(false);
  const lastResult = useRef<ParseResult | null | undefined>(undefined);

  const applyResult = (result: ParseResult | null) => {
    const fatal =
      result?.meta.errors?.some((error) => error.code === "no-root") ?? true;
    setFailed(!result || result.meta.statementCount === 0 || fatal);
  };

  useEffect(() => {
    setFailed(false);
    lastResult.current = undefined;
  }, [code]);

  useEffect(() => {
    if (!isStreaming && lastResult.current !== undefined) applyResult(lastResult.current);
  }, [isStreaming]);

  return (
    <div className="my-3" role="group" aria-label="Generated interface">
      {failed ? (
        <div className="overflow-hidden rounded-panel border border-border bg-surface-2">
          <div className="border-b border-border px-3 py-1.5 text-xs text-muted">
            This interface could not be rendered. The source is below.
          </div>
          <pre className="m-0 overflow-x-auto p-3 font-mono text-xs leading-relaxed">
            <code>{code}</code>
          </pre>
        </div>
      ) : (
        <Renderer
          library={openuiLibrary}
          response={code}
          isStreaming={isStreaming}
          onAction={(event) => {
            if (event.type === "continue_conversation") {
              if (streaming) {
                toast("Wait for the current reply to finish");
                return;
              }
              const text = event.humanFriendlyMessage.trim();
              if (!text) {
                toast("Nothing to send");
                return;
              }
              void sendMessage(text);
              return;
            }
            if (event.type === "open_url") {
              const url = typeof event.params?.url === "string" ? event.params.url : "";
              if (!/^https:\/\//i.test(url)) return;
              void openUrl(url).catch((error) => toast(errorText(error)));
            }
          }}
          onParseResult={(result) => {
            lastResult.current = result;
            if (!isStreaming) applyResult(result);
          }}
        />
      )}
    </div>
  );
}
