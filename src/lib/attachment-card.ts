import type { MessageDocAttachment } from "./types";

export interface DocCardView {
  name: string;
  extension: string;
  typeLabel: string;
  meta: string;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "Size unknown";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const MIME_LABELS: Record<string, string> = {
  "application/pdf": "PDF",
  "application/json": "JSON",
  "text/plain": "Text",
  "text/markdown": "Markdown",
  "text/csv": "CSV",
  "text/html": "HTML",
  "application/msword": "Word",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Sheet",
};

export function docExtension(name: string): string {
  const match = /\.([A-Za-z0-9]{1,8})$/.exec(name.trim());
  return match ? match[1].toUpperCase() : "";
}

function formatChars(chars: number): string {
  return `${chars.toLocaleString()} chars`;
}

export function docCard(doc: MessageDocAttachment): DocCardView {
  const extension = docExtension(doc.name);
  const typeLabel = MIME_LABELS[doc.mime] ?? (extension || "File");
  const parts: string[] = [];
  if (typeof doc.size === "number") parts.push(formatBytes(doc.size));
  if (typeof doc.chars === "number" && doc.chars > 0) parts.push(formatChars(doc.chars));
  return {
    name: doc.name,
    extension,
    typeLabel,
    meta: parts.length > 0 ? parts.join(" · ") : "Size unknown",
  };
}
