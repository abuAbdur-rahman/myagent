import { knowledgeSidecarRead, knowledgeSidecarWrite } from "./api";
import {
  addKnowledgeDoc,
  knowledgeShaExists,
  listKnowledgeDocs,
} from "./db";
import { newId } from "./utils";

export const MAX_FILES_PER_QUERY = 3;
export const MAX_EXCERPT_CHARS = 4000;

export interface KnowledgeDoc {
  name: string;
  excerpt: string;
}

const TEXT_PREFIX = "text/";
const EXTRA_MIMES = new Set([
  "application/json",
  "application/xml",
  "application/javascript",
  "application/typescript",
]);

export function isSupportedMime(mime: string): boolean {
  const base = mime.split(";")[0]?.trim().toLowerCase() ?? "";
  return base.startsWith(TEXT_PREFIX) || EXTRA_MIMES.has(base);
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
    const safeName = doc.name.replace(/[<>]/g, "");
    return `<source name=${safeName}>${excerptOf(doc.excerpt)}</source>`;
  });
  return `## Attached knowledge\n${parts.join("\n\n")}`;
}

export type IngestStatus = "added" | "duplicate" | "unsupported";

export interface IngestInput {
  projectId: string;
  chatId?: string | null;
  name: string;
  mime: string;
  bytes: Uint8Array;
}

export async function ingestDoc(
  input: IngestInput,
): Promise<{ status: IngestStatus; id?: string }> {
  if (!isSupportedMime(input.mime)) return { status: "unsupported" };
  const sha = await sha256Hex(input.bytes);
  if (await knowledgeShaExists(sha)) return { status: "duplicate" };
  const text = new TextDecoder().decode(input.bytes);
  const path = await knowledgeSidecarWrite(input.projectId, sha, text);
  const id = newId();
  await addKnowledgeDoc({
    id,
    project_id: input.projectId,
    chat_id: input.chatId ?? null,
    name: input.name,
    mime: input.mime,
    sha256: sha,
    path,
    size: input.bytes.length,
  });
  return { status: "added", id };
}

export interface AttachmentChip {
  name: string;
  excerpt: string;
}

export function buildAttachmentSend(
  text: string,
  chips: AttachmentChip[],
): { outgoing: string; block: string } {
  const trimmed = text.trim();
  return {
    outgoing: trimmed || chips.map((chip) => chip.name).join(", "),
    block: buildKnowledgeBlock(chips),
  };
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

export async function searchKnowledge(projectId: string, query: string): Promise<string> {  const terms = query.trim().split(/\s+/).filter((term) => term.length > 0);
  if (terms.length === 0) return "";
  const like = terms[0] as string;
  const rows = await listKnowledgeDocs(projectId, like);
  if (rows.length === 0) return "";
  const withExcerpts: KnowledgeDoc[] = [];
  for (const row of rows.slice(0, 20)) {
    try {
      const excerpt = await knowledgeSidecarRead(projectId, row.sha256);
      withExcerpts.push({ name: row.name, excerpt });
    } catch {
      continue;
    }
  }
  return buildKnowledgeBlock(rankDocs(withExcerpts, query));
}
