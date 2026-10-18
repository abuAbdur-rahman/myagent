import { attachmentIngest, documentRead, documentsWipeUnreferenced } from "./api";
import {
  addChatDoc,
  addKnowledgeDoc,
  findChatDoc,
  knowledgeShaExists,
  listChatDocs,
  type ChatDocRow,
} from "./db";
import { parseDocAttachments } from "./attachments";
import { sha256Hex, type MessagePart } from "./knowledge";
import { newId } from "./utils";
import type { MessageDocAttachment } from "./types";

export const MAX_DOC_BYTES = 10 * 1024 * 1024;
export const MAX_DOCS_PER_TURN = 3;
export const DOC_CHARS_PER_FILE = 40_000;
const DOC_CHARS_PER_TURN = 120_000;

export interface ChatDocument {
  name: string;
  mime: string;
  sha256: string;
  size: number;
  chars: number;
  path: string;
}

export type DocIngestResult =
  | { status: "added"; doc: ChatDocument }
  | { status: "duplicate"; doc: ChatDocument }
  | { status: "refused"; message: string };

export interface DocIngestInput {
  conversationId: string | null;
  name: string;
  mime: string;
  bytes: Uint8Array;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function base64FromBytes(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

export function documentFailureMessage(error: unknown): string {
  if (typeof error === "string" && error.length > 0) return error;
  if (typeof error === "object" && error !== null) {
    const failure = error as { code?: unknown; message?: unknown };
    if (typeof failure.message === "string" && failure.message.length > 0) {
      return failure.message;
    }
    if (typeof failure.code === "string" && failure.code.length > 0) {
      return `the file could not be read (${failure.code})`;
    }
  }
  return "the file could not be read";
}

export function toAttachment(doc: ChatDocument): MessageDocAttachment {
  return {
    kind: "doc",
    name: doc.name,
    mime: doc.mime,
    sha256: doc.sha256,
    size: doc.size,
    chars: doc.chars,
  };
}

function fromRow(row: ChatDocRow): ChatDocument {
  return {
    name: row.name,
    mime: row.mime,
    sha256: row.sha256,
    size: row.size,
    chars: row.chars,
    path: row.path,
  };
}

async function linkProjectDoc(
  projectId: string,
  conversationId: string | null,
  doc: ChatDocument,
): Promise<void> {
  try {
    if (await knowledgeShaExists(projectId, doc.sha256)) return;
    await addKnowledgeDoc({
      id: newId(),
      project_id: projectId,
      chat_id: conversationId,
      name: doc.name,
      mime: doc.mime,
      sha256: doc.sha256,
      path: doc.path,
      size: doc.size,
    });
  } catch (error) {
    console.warn("documents: project reference failed", error);
  }
}

export async function ingestChatDoc(input: DocIngestInput): Promise<DocIngestResult> {
  if (input.bytes.byteLength === 0) {
    return { status: "refused", message: "the file is empty" };
  }
  if (input.bytes.byteLength > MAX_DOC_BYTES) {
    return {
      status: "refused",
      message: `larger than ${formatBytes(MAX_DOC_BYTES)}`,
    };
  }
  const sha256 = await sha256Hex(input.bytes);
  if (input.conversationId) {
    const existing = await findChatDoc(input.conversationId, sha256);
    if (existing) return { status: "duplicate", doc: fromRow(existing) };
  }
  const name = documentName(input.name);
  let chars: number;
  let path: string;
  try {
    const ingested = await attachmentIngest(
      name,
      input.mime,
      base64FromBytes(input.bytes),
      sha256,
    );
    chars = ingested.chars;
    path = ingested.path;
  } catch (error) {
    return { status: "refused", message: documentFailureMessage(error) };
  }
  const doc: ChatDocument = {
    name,
    mime: input.mime,
    sha256,
    size: input.bytes.byteLength,
    chars,
    path,
  };
  return { status: "added", doc };
}

export async function commitChatDocs(
  conversationId: string,
  docs: ChatDocument[],
  projectId: string | null = null,
): Promise<{ committed: ChatDocument[]; failed: string[] }> {
  const committed: ChatDocument[] = [];
  const failed: string[] = [];
  for (const doc of docs) {
    try {
      if (!(await findChatDoc(conversationId, doc.sha256))) {
        await addChatDoc({
          id: newId(),
          conversation_id: conversationId,
          name: doc.name,
          mime: doc.mime,
          sha256: doc.sha256,
          path: doc.path,
          size: doc.size,
          chars: doc.chars,
        });
      }
      committed.push(doc);
      if (projectId) await linkProjectDoc(projectId, conversationId, doc);
    } catch (error) {
      console.warn(`documents: ${doc.name} was not attached`, error);
      failed.push(doc.name);
    }
  }
  return { committed, failed };
}

export async function releaseChatDoc(
  doc: ChatDocument,
  remaining: ChatDocument[] = [],
): Promise<void> {
  if (remaining.some((other) => other.sha256 === doc.sha256)) return;
  await releaseChatDocs([doc]);
}

export async function releaseChatDocs(docs: ChatDocument[]): Promise<void> {
  if (docs.length === 0) return;
  try {
    await documentsWipeUnreferenced(docs.map((doc) => doc.sha256));
  } catch (error) {
    console.warn("documents: release failed", error);
  }
}

export async function copyChatDocs(from: string, to: string): Promise<void> {
  try {
    const rows = await listChatDocs(from);
    for (const row of rows) {
      if (await findChatDoc(to, row.sha256)) continue;
      await addChatDoc({
        id: newId(),
        conversation_id: to,
        name: row.name,
        mime: row.mime,
        sha256: row.sha256,
        path: row.path,
        size: row.size,
        chars: row.chars,
      });
    }
  } catch (error) {
    console.warn("documents: branch copy failed", error);
  }
}

export interface DocumentReference {
  name: string;
  mime: string;
  sha256: string;
}

function safeSourceName(name: string): string {
  return name.replace(/["<>]/g, "").slice(0, 120);
}

function safeSourceType(mime: string): string {
  const cleaned = mime.trim().replace(/[^A-Za-z0-9/.+-]/g, "");
  return (cleaned.length > 0 ? cleaned : "document").slice(0, 120);
}

function documentName(name: string): string {
  const trimmed = name.trim();
  return (trimmed.length > 0 ? trimmed : "document").slice(0, 200);
}

function stripSourceTags(text: string): string {
  let body = text;
  for (;;) {
    const next = body.replace(/<\/source\s*>/gi, "").replace(/<source\b[^>]*>/gi, "");
    if (next === body) return body;
    body = next;
  }
}

function clampDocument(text: string, limit: number): string {
  const body = stripSourceTags(text);
  if (body.length <= limit) return body;
  return `${body.slice(0, limit)}\n[truncated: ${limit} of ${body.length} chars included, call read_document for more]`;
}

export async function buildDocumentBlock(
  docs: DocumentReference[],
  projectId: string | null = null,
): Promise<string> {
  const selected = docs.slice(0, MAX_DOCS_PER_TURN);
  if (selected.length === 0) return "";
  const parts: string[] = [];
  let budget = DOC_CHARS_PER_TURN;
  for (const doc of selected) {
    if (budget <= 0) break;
    let text: string;
    try {
      text = await documentRead(doc.sha256, projectId);
    } catch (error) {
      console.warn(`documents: ${doc.name} could not be read`, error);
      continue;
    }
    const limit = Math.min(DOC_CHARS_PER_FILE, budget);
    const body = clampDocument(text, limit);
    budget -= Math.min(body.length, limit);
    if (body.trim().length === 0) continue;
    parts.push(
      `<source name="${safeSourceName(doc.name)}" type="${safeSourceType(doc.mime)}">\n${body}\n</source>`,
    );
  }
  if (parts.length === 0) return "";
  return `## Attached documents\n${parts.join("\n\n")}`;
}

export function prependDocumentBlock(
  content: string | MessagePart[],
  block: string,
): string | MessagePart[] {
  if (block.length === 0) return content;
  if (typeof content === "string") {
    return content.trim().length > 0 ? `${block}\n\n${content}` : block;
  }
  const [first, ...rest] = content;
  if (first && first.type === "text") {
    return [{ type: "text", text: `${block}\n\n${first.text}` }, ...rest];
  }
  return [{ type: "text", text: block }, ...content];
}

export async function withDocumentBlock<
  T extends { role: string; content: string | MessagePart[]; attachments?: string | null },
>(turns: T[], projectId: string | null = null): Promise<T[]> {
  const index = turns.map((turn) => turn.role).lastIndexOf("user");
  if (index < 0) return turns;
  const docs = parseDocAttachments(turns[index].attachments);
  if (docs.length === 0) return turns;
  const block = await buildDocumentBlock(docs, projectId);
  if (block.length === 0) return turns;
  return turns.map((turn, position) =>
    position === index ? { ...turn, content: prependDocumentBlock(turn.content, block) } : turn,
  );
}
