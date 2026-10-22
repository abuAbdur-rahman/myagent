import { FileText } from "lucide-react";

import { docCard } from "../lib/attachment-card";
import type { MessageDocAttachment } from "../lib/types";

export function DocAttachmentCard({ doc }: { doc: MessageDocAttachment }) {
  const view = docCard(doc);
  return (
    <div
      className="flex w-[168px] flex-col gap-1 rounded-card border border-border bg-surface p-2"
      title={`${doc.name} · ${doc.mime || "unknown type"} · the model can read more with read_document`}
    >
      <div className="flex items-start justify-between gap-1">
        <FileText size={16} className="flex-none text-muted" aria-hidden="true" />
        <span className="rounded bg-hover px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-4 text-muted">
          {view.typeLabel}
        </span>
      </div>
      <span className="line-clamp-2 break-words text-xs leading-4">{view.name}</span>
      <span className="truncate text-[11px] text-muted">{view.meta}</span>
    </div>
  );
}
