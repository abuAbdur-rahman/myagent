import { documentRead } from "./api";
import { listKnowledgeDocs } from "./db";
import { parseImageAttachments } from "./attachments";

export const MAX_FILES_PER_QUERY = 3;
export const MAX_EXCERPT_CHARS = 4000;

export interface KnowledgeDoc {
  name: string;
  excerpt: string;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function excerptOf(text: string): string {
  if (text.length <= MAX_EXCERPT_CHARS) return text;
  return text.slice(0, MAX_EXCERPT_CHARS);
}

export function rankDocs(docs: KnowledgeDoc[], query: string): KnowledgeDoc[] {
  const terms = query.toLowerCase().split(/\s+/).filter((term) => term.length > 0);
  if (terms.length === 0) return [];
  const scored = docs
    .map((doc) => {
      const name = doc.name.toLowerCase();
      const body = doc.excerpt.toLowerCase();
      const nameHits = terms.filter((term) => name.includes(term)).length;
      const bodyHits = terms.filter((term) => body.includes(term)).length;
      return { doc, score: nameHits * 10 + bodyHits };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, MAX_FILES_PER_QUERY).map(({ doc }) => doc);
}

export function buildKnowledgeBlock(docs: KnowledgeDoc[]): string {
  if (docs.length === 0) return "";
  const parts = docs.slice(0, MAX_FILES_PER_QUERY).map((doc) => {
    const safeName = doc.name.replace(/["<>]/g, "").slice(0, 120);
    const body = excerptOf(doc.excerpt).replace(/<\/source>/gi, "");
    return `<source name="${safeName}">${body}</source>`;
  });
  return `## Attached knowledge\n${parts.join("\n\n")}`;
}

export interface ImageAttachment {
  dataUrl: string;
}

export interface TextPart {
  type: "text";
  text: string;
}

export interface ImagePart {
  type: "image_url";
  image_url: { url: string };
}

export type MessagePart = TextPart | ImagePart;

export function resolveImageSend(
  supportsVision: boolean,
  images: ImageAttachment[],
): { kept: ImageAttachment[]; dropped: boolean } {
  if (images.length === 0) return { kept: [], dropped: false };
  if (supportsVision) return { kept: images, dropped: false };
  return { kept: [], dropped: true };
}

export function buildUserContent(text: string, images: ImageAttachment[]): string | MessagePart[] {
  if (images.length === 0) return text;
  const parts: MessagePart[] = [];
  if (text.trim().length > 0) parts.push({ type: "text", text });
  for (const image of images) {
    parts.push({ type: "image_url", image_url: { url: image.dataUrl } });
  }
  return parts;
}

export function turnContent(turn: {
  content: string | MessagePart[];
  attachments?: string | null;
}): string | MessagePart[] {
  if (typeof turn.content !== "string") return turn.content;
  const images = parseImageAttachments(turn.attachments);
  return images.length > 0 ? buildUserContent(turn.content, images) : turn.content;
}

export function withFinalTurnImages<
  T extends { role: string; content: string | MessagePart[]; attachments?: string | null },
>(turns: T[]): T[] {
  const index = turns.map((turn) => turn.role).lastIndexOf("user");
  if (index < 0) return turns;
  return turns.map((turn, position) =>
    position === index ? { ...turn, content: turnContent(turn) } : turn,
  );
}

export async function searchKnowledge(projectId: string, query: string): Promise<string> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return "";
  const rows = await listKnowledgeDocs(projectId, trimmed);
  if (rows.length === 0) return "";
  const reads = await Promise.allSettled(
    rows.map(async (row) => ({
      name: row.name,
      excerpt: excerptOf(await documentRead(row.sha256, projectId)),
    })),
  );
  const withExcerpts = reads.flatMap((result) =>
    result.status === "fulfilled" ? [result.value] : [],
  );
  return buildKnowledgeBlock(rankDocs(withExcerpts, query));
}
