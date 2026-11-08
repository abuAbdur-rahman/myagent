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
      <div className="flex h-12 flex-none items-center gap-2 border-b border-line-subtle px-4">
        <button
          type="button"
          onClick={() => setView("chat")}
          aria-label="Back to chat"
          title="Back to chat"
          className="grid h-8 w-8 place-items-center rounded-field text-fg-2 hover:bg-fill-2 hover:text-fg"
        >
          <ArrowLeft size={16} />
        </button>
        <h1 className="m-0 text-sm font-semibold">Outputs</h1>
        {chat && <span className="truncate text-xs text-fg-3">{chat.title}</span>}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {outputs.length === 0 ? (
          <div className="mx-auto max-w-[560px] rounded-card bg-fill-1 px-4 py-6 shadow-[inset_0_0_0_1px_var(--line-subtle)] text-center">
            <p className="m-0 text-sm font-medium">No outputs yet</p>
            <p className="m-0 mt-1 text-xs text-fg-3">
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
                  className="flex flex-col gap-2 rounded-card bg-raised p-2 shadow-[inset_0_0_0_1px_var(--line)] hover:shadow-[inset_0_0_0_1px_var(--line-strong)] text-left hover:border-accent/60 hover:bg-hover"
                >
                  <ArtifactThumb artifact={output} />
                  <span className="flex items-center gap-1.5 px-0.5">
                    <span className="min-w-0 flex-1 truncate text-xs">{output.title}</span>
                    <span className="flex-none rounded-chip bg-fill-2 px-1.5 py-0.5 text-[10px] uppercase text-fg-3">
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
                  className="flex flex-col gap-2 rounded-card bg-raised p-2 shadow-[inset_0_0_0_1px_var(--line)] hover:shadow-[inset_0_0_0_1px_var(--line-strong)] text-left hover:border-accent/60 hover:bg-hover"
                >
                  <div className="grid h-[104px] place-items-center rounded-field bg-fill-2 text-fg-3">
                    <FileText size={20} />
                  </div>
                  <span className="flex items-center gap-1.5 px-0.5">
                    <span className="min-w-0 flex-1 truncate text-xs">{output.title}</span>
                    <span className="flex-none rounded-chip bg-fill-2 px-1.5 py-0.5 text-[10px] uppercase text-fg-3">
                      {output.lang || "file"}
                    </span>
                  </span>
                </button>
              ) : (
                <div
                  key={output.key}
                  className="flex flex-col gap-2 rounded-card bg-raised p-2 shadow-[inset_0_0_0_1px_var(--line)] hover:shadow-[inset_0_0_0_1px_var(--line-strong)]"
                >
                  <div className="grid h-[104px] place-items-center rounded-field bg-fill-2 text-fg-3">
                    <FileText size={20} />
                  </div>
                  <span className="flex items-center gap-1.5 px-0.5">
                    <span className="min-w-0 flex-1 truncate text-xs">{output.title}</span>
                    <span className="flex-none rounded-chip bg-fill-2 px-1.5 py-0.5 text-[10px] uppercase text-fg-3">
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
