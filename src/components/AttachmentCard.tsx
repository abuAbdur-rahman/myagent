import { FileText } from "lucide-react";

import { docCard } from "../lib/attachment-card";
import type { MessageDocAttachment } from "../lib/types";

export function DocAttachmentCard({ doc }: { doc: MessageDocAttachment }) {
  const view = docCard(doc);
  return (
    <div
      className="flex w-[168px] flex-col gap-1 rounded-card bg-raised p-2 shadow-[inset_0_0_0_1px_var(--line)]"
      title={`${doc.name} · ${doc.mime || "unknown type"} · the model can read more with read_document`}
    >
      <div className="flex items-start justify-between gap-1">
        <FileText size={16} className="flex-none text-fg-3" aria-hidden="true" />
        <span className="rounded-chip bg-fill-2 px-1.5 py-0.5 text-[11px] font-medium uppercase leading-4 tracking-[0.04em] text-fg-3">
          {view.typeLabel}
        </span>
      </div>
      <span className="line-clamp-2 break-words text-xs leading-4">{view.name}</span>
      <span className="truncate text-xs text-fg-3">{view.meta}</span>
    </div>
  );
}
