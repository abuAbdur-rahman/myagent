import * as db from "./db";
import type { ChatExport, Conversation, Message } from "./types";
import { chatExportSchema } from "./types";


export function conversationToMarkdown(title: string, messages: Message[]): string {
  const lines = [`# ${title}`, ""];
  for (const message of messages) {
    if (!message.content) continue;
    lines.push(message.role === "user" ? "## You" : "## Assistant", "", message.content, "");
  }
  return lines.join("\n");
}

export function buildChatExport(chat: Conversation, messages: Message[]): ChatExport {
  const ordered = [...messages].sort((a, b) => a.created_at - b.created_at);
  return {
    app: "myagent",
    format: 1,
    exportedAt: new Date().toISOString(),
    chat: {
      title: chat.title,
      model: chat.model,
      pinned: chat.pinned === 1,
      projectId: chat.project_id,
      summary: chat.summary,
    },
    messages: ordered.map((message, index) => ({
      id: message.id,
      parentId: index > 0 ? ordered[index - 1].id : null,
      childrenIds: index + 1 < ordered.length ? [ordered[index + 1].id] : [],
      role: message.role,
      content: message.content,
      reasoning: db.sqlNull(message.reasoning),
      thinkingMs: db.sqlNull(message.thinking_ms),
      usage:
        message.prompt_tokens != null ||
        message.completion_tokens != null ||
        message.total_tokens != null
          ? {
              prompt: message.prompt_tokens ?? 0,
              completion: message.completion_tokens ?? 0,
              total: message.total_tokens ?? 0,
            }
          : null,
      finishReason: db.sqlNull(message.finish_reason),
      toolLog: db.parseToolLog(message.tool_log),
      artifacts: db.parseDeclaredArtifacts(message.artifacts),
      model: db.sqlNull(message.model),
      rating: message.rating ?? null,
      createdAt: message.created_at,
    })),
  };
}

export function safeFilename(title: string, ext = "md"): string {
  const cleaned = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${cleaned || "chat"}.${ext}`;
}

export async function importChatExport(raw: unknown): Promise<string> {
  let value: unknown = raw;
  if (typeof raw === "string") {
    if (raw.length > 5_000_000) throw new Error("File too large");
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error("Not valid JSON");
    }
  }
  const parsed = chatExportSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Not a MyAgent export");
  }
  const data = parsed.data;
  const seen = new Set<string>();
  for (const message of data.messages) {
    if (seen.has(message.id)) throw new Error("Duplicate message id");
    seen.add(message.id);
  }
  for (const message of data.messages) {
    if (message.parentId !== null && !seen.has(message.parentId)) {
      throw new Error("Broken message chain");
    }
  }
  const created = await db.createConversation(null, data.chat.model, null);
  await db.touchConversation(created.id, { title: data.chat.title });
  if (data.chat.pinned) await db.toggleConversationPin(created.id);
  if (data.chat.summary) await db.setConversationSummary(created.id, data.chat.summary, null);
  const ordered = [...data.messages].sort((a, b) => a.createdAt - b.createdAt);
  for (const message of ordered) {
    await db.insertMessageFull(created.id, {
      role: message.role,
      content: message.content,
      reasoning: message.reasoning,
      thinkingMs: message.thinkingMs,
      promptTokens: db.sqlNull(message.usage?.prompt),
      completionTokens: db.sqlNull(message.usage?.completion),
      totalTokens: db.sqlNull(message.usage?.total),
      finishReason: message.finishReason,
      toolLogJson:
        message.toolLog.length > 0 ? JSON.stringify(message.toolLog) : null,
      artifactsJson:
        message.artifacts.length > 0 ? JSON.stringify(message.artifacts) : null,
      model: db.sqlNull(message.model),
      createdAt: message.createdAt,
    });
  }
  return created.id;
}
