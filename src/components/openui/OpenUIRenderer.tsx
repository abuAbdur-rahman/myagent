import { useEffect, useState } from "react";
import { Renderer } from "@openuidev/react-lang";
import { openUrl } from "@tauri-apps/plugin-opener";

import { openuiLibrary } from "../../lib/openui/library";
import { toast } from "../../lib/toast";
import { useApp } from "../../lib/store";
import { errorText } from "../../lib/utils";

export function OpenUIRenderer({ code, isStreaming }: { code: string; isStreaming: boolean }) {
  const { sendMessage, streaming } = useApp();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [code]);

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
              void sendMessage(event.humanFriendlyMessage);
              return;
            }
            if (event.type === "open_url") {
              const url = typeof event.params?.url === "string" ? event.params.url : "";
              if (!/^https:\/\//i.test(url)) return;
              void openUrl(url).catch((error) => toast(errorText(error)));
            }
          }}
          onParseResult={(result) => {
            if (isStreaming) return;
            const fatal =
              result?.meta.errors?.some((error) => error.code === "no-root") ?? true;
            setFailed(!result || result.meta.statementCount === 0 || fatal);
          }}
        />
      )}
    </div>
  );
}
