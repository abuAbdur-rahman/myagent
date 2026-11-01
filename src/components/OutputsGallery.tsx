import { useMemo } from "react";
import { ArrowLeft, FileText } from "lucide-react";

import { useApp } from "../lib/store";
import { sessionOutputs } from "../lib/session";
import { ArtifactThumb } from "./ArtifactThumb";

const PREVIEWABLE = new Set(["pdf", "docx", "pptx", "xlsx", "odt", "ods", "odp"]);

export function OutputsGallery() {
  const { messages, conversations, activeConversationId, setView, openArtifact } = useApp();
  const chat = conversations.find((item) => item.id === activeConversationId) ?? null;
  const outputs = useMemo(() => sessionOutputs(messages), [messages]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-12 flex-none items-center gap-2 border-b border-border px-4">
        <button
          type="button"
          onClick={() => setView("chat")}
          aria-label="Back to chat"
          title="Back to chat"
          className="grid h-8 w-8 place-items-center rounded-control text-muted hover:bg-hover hover:text-text"
        >
          <ArrowLeft size={16} />
        </button>
        <h1 className="m-0 text-sm font-semibold">Outputs</h1>
        {chat && <span className="truncate text-xs text-muted">{chat.title}</span>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {outputs.length === 0 ? (
          <div className="mx-auto max-w-[560px] rounded-card border border-border bg-surface-2 px-4 py-6 text-center">
            <p className="m-0 text-sm font-medium">No outputs yet</p>
            <p className="m-0 mt-1 text-xs text-muted">
              Artifacts the agent renders and files it writes in this chat show up here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-3">
            {outputs.map((output) =>
              output.kind === "artifact" ? (
                <button
                  key={output.key}
                  type="button"
                  onClick={() =>
                    openArtifact({
                      id: output.key,
                      title: output.title,
                      lang: output.lang,
                      code: output.code,
                    })
                  }
                  className="flex flex-col gap-2 rounded-card border border-border bg-surface p-2 text-left hover:border-accent/60 hover:bg-hover"
                >
                  <ArtifactThumb artifact={output} />
                  <span className="flex items-center gap-1.5 px-0.5">
                    <span className="min-w-0 flex-1 truncate text-xs">{output.title}</span>
                    <span className="flex-none rounded bg-hover px-1 py-0.5 text-[10px] uppercase text-muted">
                      {output.lang || "text"}
                    </span>
                  </span>
                </button>
              ) : PREVIEWABLE.has(output.lang) ? (
                <button
                  key={output.key}
                  type="button"
                  onClick={() =>
                    openArtifact({
                      id: output.key,
                      title: output.title,
                      lang: output.lang,
                      code: "",
                      path: output.path,
                    })
                  }
                  className="flex flex-col gap-2 rounded-card border border-border bg-surface p-2 text-left hover:border-accent/60 hover:bg-hover"
                >
                  <div className="grid h-[104px] place-items-center rounded-control bg-surface-2 text-muted">
                    <FileText size={20} />
                  </div>
                  <span className="flex items-center gap-1.5 px-0.5">
                    <span className="min-w-0 flex-1 truncate text-xs">{output.title}</span>
                    <span className="flex-none rounded bg-hover px-1 py-0.5 text-[10px] uppercase text-muted">
                      {output.lang || "file"}
                    </span>
                  </span>
                </button>
              ) : (
                <div
                  key={output.key}
                  className="flex flex-col gap-2 rounded-card border border-border bg-surface p-2"
                >
                  <div className="grid h-[104px] place-items-center rounded-control bg-surface-2 text-muted">
                    <FileText size={20} />
                  </div>
                  <span className="flex items-center gap-1.5 px-0.5">
                    <span className="min-w-0 flex-1 truncate text-xs">{output.title}</span>
                    <span className="flex-none rounded bg-hover px-1 py-0.5 text-[10px] uppercase text-muted">
                      {output.lang || "file"}
                    </span>
                  </span>
                </div>
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}
