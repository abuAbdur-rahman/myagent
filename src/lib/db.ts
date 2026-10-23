import Database from "@tauri-apps/plugin-sql";
import {
  documentsWipeAll,
  documentsWipeUnreferenced,
  knowledgeSidecarDelete,
  knowledgeSidecarWipe,
  knowledgeSidecarWipeAll,
  type McpServerRow,
} from "./api";
import { newId } from "./utils";
import type {
  AuditLog,
  Connection,
  ConnectionInput,
  Conversation,
  ExportBundle,
  ExportScope,
  Memory,
  MemoryInput,
  MemoryKind,
  MemoryScope,
  Message,
  MessageAttachmentInput,
  PendingMemory,
  Project,
  ProjectInput,
  Role,
  Tag,
  Todo,
} from "./types";
import {
  auditLogSchema,
  exportBundleSchema,
  pendingMemorySchema,
  tagSchema,
  todoSchema,
} from "./types";
import { plainTitle } from "./title";

let dbPromise: Promise<Database> | null = null;

function getDb() {
  if (!dbPromise) {
    dbPromise = Database.load("sqlite:myagent.db").catch((error) => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

export function sqlNull<T>(value: T | null | undefined): T | null {
  return value ?? null;
}

export async function listConnections(): Promise<Connection[]> {
  const db = await getDb();
  return db.select<Connection[]>(
    "SELECT * FROM connections ORDER BY created_at ASC",
  );
}

export async function createConnection(input: ConnectionInput): Promise<Connection> {
  const db = await getDb();
  const connection: Connection = {
    ...input,
    id: newId(),
    created_at: Date.now(),
  };
  await db.execute(
    "INSERT INTO connections (id, name, base_url, kind, default_model, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [
      connection.id,
      connection.name,
      connection.base_url,
      connection.kind,
      connection.default_model,
      connection.created_at,
    ],
  );
  return connection;
}

export async function updateConnection(connection: Connection): Promise<void> {  const db = await getDb();
  await db.execute(
    "UPDATE connections SET name = $1, base_url = $2, kind = $3, default_model = $4 WHERE id = $5",
    [
      connection.name,
      connection.base_url,
      connection.kind,
      connection.default_model,
      connection.id,
    ],
  );
}

export async function markKeyTested(id: string, at: number = Date.now()): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE connections SET key_tested_at = $1 WHERE id = $2", [at, id]);
}

export async function clearKeyTested(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE connections SET key_tested_at = NULL WHERE id = $1", [id]);
}

export async function deleteConnection(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM connections WHERE id = $1", [id]);
}

export async function listConversations(): Promise<Conversation[]> {
  const db = await getDb();
  const rows = await db.select<Conversation[]>(
    "SELECT * FROM conversations ORDER BY updated_at DESC",
  );
  return rows.map((row) => ({ ...row, title: plainTitle(row.title) || "New chat" }));
}

export async function createConversation(
  connectionId: string | null,
  model: string | null,
  projectId: string | null,
): Promise<Conversation> {
  const db = await getDb();
  const now = Date.now();
  const conversation: Conversation = {
    id: newId(),
    title: "New chat",
    connection_id: connectionId,
    project_id: projectId,
    pinned: 0,
    compacted: 0,
    model,
    summary: null,
    summary_through: null,
    created_at: now,
    updated_at: now,
  };
  await db.execute(
    "INSERT INTO conversations (id, title, connection_id, project_id, pinned, compacted, model, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    [
      conversation.id,
      conversation.title,
      conversation.connection_id,
      conversation.project_id,
      conversation.pinned,
      conversation.compacted,
      conversation.model,
      conversation.created_at,
      conversation.updated_at,
    ],
  );
  return conversation;
}

export async function touchConversation(
  id: string,
  patch: Partial<
    Pick<Conversation, "title" | "model" | "connection_id" | "project_id" | "system_prompt">
  >,
): Promise<void> {
  const db = await getDb();
  const assignments: string[] = [];
  const values: unknown[] = [];
  for (const [column, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    values.push(value);
    assignments.push(`${column} = $${values.length}`);
  }
  values.push(Date.now());
  assignments.push(`updated_at = $${values.length}`);
  values.push(id);
  await db.execute(
    `UPDATE conversations SET ${assignments.join(", ")} WHERE id = $${values.length}`,
    values,
  );
}

export async function deleteConversation(id: string): Promise<void> {
  const db = await getDb();
  const shas = await conversationDocShas(id);
  await db.execute("DELETE FROM messages WHERE conversation_id = $1", [id]);
  await db.execute("DELETE FROM chat_tags WHERE chat_id = $1", [id]);
  await db.execute("DELETE FROM todos WHERE chat_id = $1", [id]);
  await db.execute("DELETE FROM chat_docs WHERE conversation_id = $1", [id]);
  await db.execute("DELETE FROM conversations WHERE id = $1", [id]);
  await wipeUnreferencedDocs(shas);
}

export async function wipeAll(): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM chat_tags");
  await db.execute("DELETE FROM todos");
  await db.execute("DELETE FROM knowledge_docs");
  await db.execute("DELETE FROM chat_docs");
  await db.execute("DELETE FROM messages");
  await db.execute("DELETE FROM conversations");
  await db.execute("DELETE FROM memories");
  await db.execute("DELETE FROM pending_memories");
  await db.execute("DELETE FROM projects");
  await db.execute("DELETE FROM audit_log");
  await db.execute("DELETE FROM permission_rules");
  await db.execute("DELETE FROM mcp_servers");
  await knowledgeSidecarWipeAll();
  await documentsWipeAll();
  await db.execute("VACUUM");
}

export interface ImportReport {
  projects: number;
  conversations: number;
  messages: number;
  memories: number;
  skippedConversations: number;
  skippedMemories: number;
}

export async function exportBundle(scope: ExportScope): Promise<ExportBundle> {
  const projects = await listProjects();
  const bundle: ExportBundle = {
    version: 1,
    exportedAt: new Date().toISOString(),
    scope,
    conversations: [],
    projects: [],
    memories: [],
  };
  if (scope !== "memory") {
    const conversations = await listConversations();
    bundle.conversations = await Promise.all(
      conversations.map(async (conversation) => ({
        ...conversation,
        messages: await listMessages(conversation.id),
      })),
    );
    bundle.projects = projects;
  }
  if (scope !== "chats") {
    const global = await listMemories("global", null);
    const perProject = await Promise.all(
      projects.map((project) => listMemories("project", project.id)),
    );
    bundle.memories = [...global, ...perProject.flat()];
    if (scope === "memory") bundle.projects = projects;
  }
  return bundle;
}

export async function importBundle(input: unknown): Promise<ImportReport> {
  const parsed = exportBundleSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Not a myagent export file");
  }
  const bundle = parsed.data;
  const db = await getDb();
  const report: ImportReport = {
    projects: 0,
    conversations: 0,
    messages: 0,
    memories: 0,
    skippedConversations: 0,
    skippedMemories: 0,
  };

  const legacyProjects = (bundle.projectMemories ?? []).map((entry) => entry.project);
  const projects = new Map<string, Project>();
  for (const project of [...bundle.projects, ...legacyProjects]) {
    projects.set(project.id, project);
  }
  const projectIds = new Set(
    (await db.select<{ id: string }[]>("SELECT id FROM projects")).map((row) => row.id),
  );
  for (const project of projects.values()) {
    const result = await db.execute(
      "INSERT OR IGNORE INTO projects (id, name, description, instructions, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)",
      [
        project.id,
        project.name,
        project.description,
        project.instructions,
        project.created_at,
        project.updated_at,
      ],
    );
    if (result.rowsAffected > 0) report.projects += 1;
    projectIds.add(project.id);
  }

  for (const conversation of bundle.conversations) {
    const existing = await db.select<{ id: string }[]>(
      "SELECT id FROM conversations WHERE id = $1",
      [conversation.id],
    );
    if (existing.length > 0) {
      report.skippedConversations += 1;
      continue;
    }
    const projectId =
      conversation.project_id && projectIds.has(conversation.project_id)
        ? conversation.project_id
        : null;
    await db.execute(
      "INSERT INTO conversations (id, title, connection_id, project_id, pinned, compacted, model, summary, summary_through, system_prompt, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
      [
        conversation.id,
        conversation.title,
        null,
        projectId,
        conversation.pinned,
        conversation.compacted,
        conversation.model,
        sqlNull(conversation.summary),
        sqlNull(conversation.summary_through),
        sqlNull(conversation.system_prompt),
        conversation.created_at,
        conversation.updated_at,
      ],
    );
    report.conversations += 1;
    for (const message of conversation.messages) {
      const result = await db.execute(
        "INSERT OR IGNORE INTO messages (id, conversation_id, role, content, reasoning, thinking_ms, prompt_tokens, completion_tokens, total_tokens, finish_reason, tool_log, artifacts, attachments, model, rating, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)",
        [
          message.id,
          conversation.id,
          message.role,
          message.content,
          sqlNull(message.reasoning),
          sqlNull(message.thinking_ms),
          sqlNull(message.prompt_tokens),
          sqlNull(message.completion_tokens),
          sqlNull(message.total_tokens),
          sqlNull(message.finish_reason),
          sqlNull(message.tool_log),
          sqlNull(message.artifacts),
          sqlNull(message.attachments),
          sqlNull(message.model),
          sqlNull(message.rating),
          message.created_at,
        ],
      );
      if (result.rowsAffected > 0) report.messages += 1;
    }
  }

  const memories = new Map<string, Memory>();
  for (const memory of [
    ...bundle.memories,
    ...(bundle.globalMemories ?? []),
    ...(bundle.projectMemories ?? []).flatMap((entry) => entry.memories),
  ]) {
    memories.set(memory.id, memory);
  }
  for (const memory of memories.values()) {
    const projectId = memory.scope === "project" ? memory.project_id : null;
    if (memory.scope === "project" && (!projectId || !projectIds.has(projectId))) {
      report.skippedMemories += 1;
      continue;
    }
    const result = await db.execute(
      "INSERT OR IGNORE INTO memories (id, scope, project_id, kind, content, source_conversation_id, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)",
      [
        memory.id,
        memory.scope,
        projectId,
        memory.kind,
        memory.content,
        sqlNull(memory.source_conversation_id),
        memory.created_at,
        memory.updated_at,
      ],
    );
    if (result.rowsAffected > 0) report.memories += 1;
    else report.skippedMemories += 1;
  }

  return report;
}

export async function listTags(conversationId: string): Promise<Tag[]> {
  const db = await getDb();
  const rows = await db.select<{ tag: string }[]>(
    "SELECT tag FROM chat_tags WHERE chat_id = $1 ORDER BY tag ASC",
    [conversationId],
  );
  return rows.map((row) => row.tag);
}

export async function chatTagMap(): Promise<Map<string, string[]>> {
  const db = await getDb();
  const rows = await db.select<{ chat_id: string; tag: string }[]>(
    "SELECT chat_id, tag FROM chat_tags ORDER BY tag ASC",
  );
  const map = new Map<string, string[]>();
  for (const row of rows) {
    const list = map.get(row.chat_id) ?? [];
    list.push(row.tag);
    map.set(row.chat_id, list);
  }
  return map;
}

export async function listAllTags(): Promise<{ tag: string; count: number }[]> {
  const db = await getDb();
  return db.select<{ tag: string; count: number }[]>(
    "SELECT tag, COUNT(*) AS count FROM chat_tags GROUP BY tag ORDER BY tag ASC",
  );
}

export async function addTag(conversationId: string, tag: string): Promise<void> {
  const parsed = tagSchema.safeParse(tag);
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Invalid tag");
  }
  const db = await getDb();
  await db.execute("INSERT OR IGNORE INTO chat_tags (chat_id, tag) VALUES ($1, $2)", [
    conversationId,
    parsed.data,
  ]);
}

export async function removeTag(conversationId: string, tag: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM chat_tags WHERE chat_id = $1 AND tag = $2", [
    conversationId,
    tag,
  ]);
}

export async function listTodos(conversationId: string): Promise<Todo[]> {
  const db = await getDb();
  const rows = await db.select<unknown[]>(
    "SELECT * FROM todos WHERE chat_id = $1 ORDER BY position ASC, created_at ASC",
    [conversationId],
  );
  return rows
    .map((row) => todoSchema.safeParse(row))
    .filter((parsed) => parsed.success)
    .map((parsed) => parsed.data);
}

export async function listMessages(conversationId: string): Promise<Message[]> {
  const db = await getDb();
  return db.select<Message[]>(
    "SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC",
    [conversationId],
  );
}

export async function addMessage(
  conversationId: string,
  role: Role,
  content: string,
  model?: string | null,
): Promise<Message> {
  const db = await getDb();
  const message: Message = {
    id: newId(),
    conversation_id: conversationId,
    role,
    content,
    model: model ?? null,
    created_at: Date.now(),
  };
  await db.execute(
    "INSERT INTO messages (id, conversation_id, role, content, model, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [
      message.id,
      message.conversation_id,
      message.role,
      message.content,
      message.model,
      message.created_at,
    ],
  );
  return message;
}

export async function updateMessage(id: string, content: string): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE messages SET content = $1 WHERE id = $2", [
    content,
    id,
  ]);
}

export async function updateMessageAttachments(
  id: string,
  attachments: MessageAttachmentInput[],
): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE messages SET attachments = $1 WHERE id = $2", [
    attachments.length > 0 ? JSON.stringify(attachments) : null,
    id,
  ]);
}

export interface FullMessageInput {
  role: Role;
  content: string;
  reasoning?: string | null;
  thinkingMs?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  finishReason?: string | null;
  toolLogJson?: string | null;
  artifactsJson?: string | null;
  model?: string | null;
  createdAt?: number | null;
}

export async function insertMessageFull(
  conversationId: string,
  input: FullMessageInput,
): Promise<Message> {
  const db = await getDb();
  const message: Message = {
    id: newId(),
    conversation_id: conversationId,
    role: input.role,
    content: input.content,
    model: sqlNull(input.model),
    created_at: input.createdAt ?? Date.now(),
  };
  await db.execute(
    "INSERT INTO messages (id, conversation_id, role, content, model, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [
      message.id,
      message.conversation_id,
      message.role,
      message.content,
      message.model,
      message.created_at,
    ],
  );
  await updateMessageMeta(message.id, {
    reasoning: sqlNull(input.reasoning),
    thinkingMs: sqlNull(input.thinkingMs),
    promptTokens: sqlNull(input.promptTokens),
    completionTokens: sqlNull(input.completionTokens),
    totalTokens: sqlNull(input.totalTokens),
    finishReason: sqlNull(input.finishReason),
    toolLogJson: sqlNull(input.toolLogJson),
    artifactsJson: sqlNull(input.artifactsJson),
  });
  return message;
}

export interface MessageMeta {
  reasoning: string | null;
  thinkingMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  finishReason: string | null;
  toolLogJson: string | null;
  artifactsJson: string | null;
}

export async function updateMessageMeta(id: string, meta: MessageMeta): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE messages SET reasoning = $1, thinking_ms = $2, prompt_tokens = $3, completion_tokens = $4, total_tokens = $5, finish_reason = $6, tool_log = $7, artifacts = $8 WHERE id = $9",
    [
      meta.reasoning,
      meta.thinkingMs,
      meta.promptTokens,
      meta.completionTokens,
      meta.totalTokens,
      meta.finishReason,
      meta.toolLogJson,
      meta.artifactsJson,
      id,
    ],
  );
}

export async function deleteMessage(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM messages WHERE id = $1", [id]);
}

export async function setMessageRating(id: string, rating: number | null): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE messages SET rating = $1 WHERE id = $2", [rating, id]);
}

export { parseDeclaredArtifacts, parseToolLog } from "./message-parse";

export async function truncateConversation(
  conversationId: string,
  keepThroughId: string,
): Promise<void> {
  const db = await getDb();
  const rows = await db.select<{ id: string }[]>(
    "SELECT id FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC",
    [conversationId],
  );
  const index = rows.findIndex((row) => row.id === keepThroughId);
  const after = index >= 0 ? rows.slice(index + 1) : rows;
  for (const row of after) {
    await db.execute("DELETE FROM messages WHERE id = $1", [row.id]);
  }
}

export async function clearConversation(conversationId: string): Promise<void> {
  const db = await getDb();
  const shas = await conversationDocShas(conversationId);
  await db.execute("DELETE FROM messages WHERE conversation_id = $1", [conversationId]);
  await db.execute("DELETE FROM todos WHERE chat_id = $1", [conversationId]);
  await db.execute("DELETE FROM chat_docs WHERE conversation_id = $1", [conversationId]);
  await wipeUnreferencedDocs(shas);
}

export async function branchConversation(
  sourceId: string,
  upToMessageId: string,
  title: string,
): Promise<Conversation> {
  const db = await getDb();
  const [source] = await db.select<Conversation[]>(
    "SELECT * FROM conversations WHERE id = $1",
    [sourceId],
  );
  if (!source) throw new Error("Conversation not found");
  const now = Date.now();
  const branched: Conversation = {
    ...source,
    id: newId(),
    title,
    pinned: 0,
    compacted: 0,
    created_at: now,
    updated_at: now,
  };
  await db.execute(
    "INSERT INTO conversations (id, title, connection_id, project_id, pinned, compacted, model, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    [
      branched.id,
      branched.title,
      branched.connection_id,
      branched.project_id,
      branched.pinned,
      branched.compacted,
      branched.model,
      branched.created_at,
      branched.updated_at,
    ],
  );
  const rows = await db.select<Message[]>(
    "SELECT * FROM messages WHERE conversation_id = $1 ORDER BY created_at ASC",
    [sourceId],
  );
  const index = rows.findIndex((m) => m.id === upToMessageId);
  const keep = index >= 0 ? rows.slice(0, index + 1) : rows;
  for (const m of keep) {
    await db.execute(
      "INSERT INTO messages (id, conversation_id, role, content, reasoning, thinking_ms, prompt_tokens, completion_tokens, total_tokens, finish_reason, tool_log, artifacts, attachments, model, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)",
      [
        newId(),
        branched.id,
        m.role,
        m.content,
        sqlNull(m.reasoning),
        sqlNull(m.thinking_ms),
        sqlNull(m.prompt_tokens),
        sqlNull(m.completion_tokens),
        sqlNull(m.total_tokens),
        sqlNull(m.finish_reason),
        sqlNull(m.tool_log),
        sqlNull(m.artifacts),
        sqlNull(m.attachments),
        sqlNull(m.model),
        m.created_at,
      ],
    );
  }
  return branched;
}

export async function toggleConversationPin(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE conversations SET pinned = CASE WHEN pinned = 1 THEN 0 ELSE 1 END, updated_at = $1 WHERE id = $2",
    [Date.now(), id],
  );
}

export async function setConversationCompacted(id: string, compacted: boolean): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE conversations SET compacted = $1, updated_at = $2 WHERE id = $3", [
    compacted ? 1 : 0,
    Date.now(),
    id,
  ]);
}

export async function setConversationSummary(
  id: string,
  summary: string | null,
  through: number | null,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE conversations SET summary = $1, summary_through = $2, updated_at = $3 WHERE id = $4",
    [summary, through, Date.now(), id],
  );
}

export async function listProjects(): Promise<Project[]> {
  const db = await getDb();
  return db.select<Project[]>(
    "SELECT * FROM projects ORDER BY name COLLATE NOCASE ASC",
  );
}

export async function createProject(input: ProjectInput): Promise<Project> {
  const db = await getDb();
  const now = Date.now();
  const project: Project = {
    ...input,
    id: newId(),
    created_at: now,
    updated_at: now,
  };
  await db.execute(
    "INSERT INTO projects (id, name, description, instructions, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [
      project.id,
      project.name,
      project.description,
      project.instructions,
      project.created_at,
      project.updated_at,
    ],
  );
  return project;
}

export async function updateProject(project: Project): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE projects SET name = $1, description = $2, instructions = $3, updated_at = $4 WHERE id = $5",
    [
      project.name,
      project.description,
      project.instructions,
      Date.now(),
      project.id,
    ],
  );
}

export async function deleteProject(id: string): Promise<void> {
  const db = await getDb();
  const shas = await projectDocShas(id);
  await db.execute(
    "DELETE FROM memories WHERE scope = 'project' AND project_id = $1",
    [id],
  );
  await db.execute("UPDATE conversations SET project_id = NULL WHERE project_id = $1", [
    id,
  ]);
  await db.execute("DELETE FROM knowledge_docs WHERE project_id = $1", [id]);
  await db.execute("DELETE FROM mcp_servers WHERE project_id = $1", [id]);
  await knowledgeSidecarWipe(id);
  await db.execute("DELETE FROM projects WHERE id = $1", [id]);
  await wipeUnreferencedDocs(shas);
}

export async function listMemories(
  scope: MemoryScope,
  projectId: string | null,
): Promise<Memory[]> {
  const db = await getDb();
  if (scope === "project") {
    if (!projectId) return [];
    return db.select<Memory[]>(
      "SELECT * FROM memories WHERE scope = 'project' AND project_id = $1 ORDER BY created_at DESC",
      [projectId],
    );
  }
  return db.select<Memory[]>(
    "SELECT * FROM memories WHERE scope = 'global' ORDER BY created_at DESC",
  );
}

export async function createMemory(input: MemoryInput): Promise<Memory> {
  const db = await getDb();
  const now = Date.now();
  const memory: Memory = {
    ...input,
    id: newId(),
    created_at: now,
    updated_at: now,
  };
  await db.execute(
    "INSERT INTO memories (id, scope, project_id, kind, content, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)",
    [
      memory.id,
      memory.scope,
      memory.project_id,
      memory.kind,
      memory.content,
      memory.created_at,
      memory.updated_at,
    ],
  );
  return memory;
}

export async function updateMemory(
  id: string,
  content: string,
  kind: MemoryKind,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    "UPDATE memories SET content = $1, kind = $2, updated_at = $3 WHERE id = $4",
    [content, kind, Date.now(), id],
  );
}

export async function deleteMemory(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM memories WHERE id = $1", [id]);
}

export async function listPendingMemories(): Promise<PendingMemory[]> {
  const db = await getDb();
  const rows = await db.select<unknown[]>(
    "SELECT id, scope, project_id, kind, content, conversation_id, created_at FROM pending_memories ORDER BY created_at DESC",
  );
  return rows.flatMap((row) => {
    const parsed = pendingMemorySchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

export async function approvePendingMemory(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT OR IGNORE INTO memories (id, scope, project_id, kind, content, source_conversation_id, created_at, updated_at) SELECT id, scope, project_id, kind, content, conversation_id, created_at, created_at FROM pending_memories WHERE id = $1",
    [id],
  );
  await db.execute("DELETE FROM pending_memories WHERE id = $1", [id]);
}

export async function dismissPendingMemory(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM pending_memories WHERE id = $1", [id]);
}

export async function restorePendingMemory(id: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT OR IGNORE INTO pending_memories (id, scope, project_id, kind, content, conversation_id, created_at) SELECT id, scope, project_id, kind, content, source_conversation_id, created_at FROM memories WHERE id = $1",
    [id],
  );
  await db.execute("DELETE FROM memories WHERE id = $1", [id]);
}

export async function listHiddenModels(connectionId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select<{ model_id: string }[]>(
    "SELECT model_id FROM hidden_models WHERE connection_id = $1",
    [connectionId],
  );
  return rows.map((row) => row.model_id);
}

export async function hideModel(connectionId: string, modelId: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT OR IGNORE INTO hidden_models (connection_id, model_id) VALUES ($1, $2)",
    [connectionId, modelId],
  );
}

export async function unhideModel(connectionId: string, modelId: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM hidden_models WHERE connection_id = $1 AND model_id = $2", [
    connectionId,
    modelId,
  ]);
}

export async function hideAllModels(connectionId: string, modelIds: string[]): Promise<void> {
  const db = await getDb();
  for (const modelId of modelIds) {
    await db.execute(
      "INSERT OR IGNORE INTO hidden_models (connection_id, model_id) VALUES ($1, $2)",
      [connectionId, modelId],
    );
  }
}

export async function unhideAllModels(connectionId: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM hidden_models WHERE connection_id = $1", [connectionId]);
}

export interface DatabaseStats {
  conversations: number;
  messages: number;
  memories: number;
  projects: number;
}

export async function stats(): Promise<DatabaseStats> {
  const db = await getDb();
  const count = async (table: string) => {
    const rows = await db.select<{ n: number }[]>(`SELECT COUNT(*) AS n FROM ${table}`);
    return rows[0]?.n ?? 0;
  };
  const [conversations, messages, memories, projects] = await Promise.all([
    count("conversations"),
    count("messages"),
    count("memories"),
    count("projects"),
  ]);
  return { conversations, messages, memories, projects };
}

export interface KnowledgeDocRow {
  id: string;
  project_id: string;
  chat_id: string | null;
  name: string;
  mime: string;
  sha256: string;
  path: string;
  size: number;
  created_at: number;
}

export async function addKnowledgeDoc(row: Omit<KnowledgeDocRow, "created_at">): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO knowledge_docs (id, project_id, chat_id, name, mime, sha256, path, size, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    [
      row.id,
      row.project_id,
      sqlNull(row.chat_id),
      row.name,
      row.mime,
      row.sha256,
      row.path,
      row.size,
      Date.now(),
    ],
  );
}

export async function knowledgeShaExists(projectId: string, sha256: string): Promise<boolean> {
  const db = await getDb();
  const rows = await db.select<{ id: string }[]>(
    "SELECT id FROM knowledge_docs WHERE project_id = $1 AND sha256 = $2 LIMIT 1",
    [projectId, sha256],
  );
  return rows.length > 0;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

export async function listKnowledgeDocs(
  projectId: string,
  query?: string,
): Promise<KnowledgeDocRow[]> {
  const db = await getDb();
  if (query && query.trim().length > 0) {
    const like = `%${escapeLike(query.trim())}%`;
    return db.select<KnowledgeDocRow[]>(
      "SELECT * FROM knowledge_docs WHERE project_id = $1 AND name LIKE $2 ESCAPE '\\' ORDER BY created_at DESC LIMIT 20",
      [projectId, like],
    );
  }
  return db.select<KnowledgeDocRow[]>(
    "SELECT * FROM knowledge_docs WHERE project_id = $1 ORDER BY created_at DESC",
    [projectId],
  );
}

export async function deleteKnowledgeDoc(
  id: string,
  projectId: string,
  sha256: string,
): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM knowledge_docs WHERE id = $1", [id]);
  try {
    await knowledgeSidecarDelete(projectId, sha256);
  } catch (error) {
    console.warn("documents: legacy sidecar delete failed", error);
  }
  try {
    await documentsWipeUnreferenced([sha256]);
  } catch (error) {
    console.warn("documents: shared-store cleanup failed", error);
  }
}

export interface ChatDocRow {
  id: string;
  conversation_id: string;
  name: string;
  mime: string;
  sha256: string;
  path: string;
  size: number;
  chars: number;
  created_at: number;
}

export async function addChatDoc(row: Omit<ChatDocRow, "created_at">): Promise<void> {
  const db = await getDb();
  await db.execute(
    "INSERT INTO chat_docs (id, conversation_id, name, mime, sha256, path, size, chars, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
    [
      row.id,
      row.conversation_id,
      row.name,
      row.mime,
      row.sha256,
      row.path,
      row.size,
      row.chars,
      Date.now(),
    ],
  );
}

export async function findChatDoc(
  conversationId: string,
  sha256: string,
): Promise<ChatDocRow | null> {
  const db = await getDb();
  const rows = await db.select<ChatDocRow[]>(
    "SELECT * FROM chat_docs WHERE conversation_id = $1 AND sha256 = $2 LIMIT 1",
    [conversationId, sha256],
  );
  return rows[0] ?? null;
}

export async function listChatDocs(conversationId: string): Promise<ChatDocRow[]> {
  const db = await getDb();
  return db.select<ChatDocRow[]>(
    "SELECT * FROM chat_docs WHERE conversation_id = $1 ORDER BY created_at ASC",
    [conversationId],
  );
}

async function conversationDocShas(conversationId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select<{ sha256: string }[]>(
    "SELECT sha256 FROM chat_docs WHERE conversation_id = $1",
    [conversationId],
  );
  return rows.map((row) => row.sha256);
}

async function projectDocShas(projectId: string): Promise<string[]> {
  const db = await getDb();
  const rows = await db.select<{ sha256: string }[]>(
    "SELECT sha256 FROM knowledge_docs WHERE project_id = $1",
    [projectId],
  );
  return rows.map((row) => row.sha256);
}

async function wipeUnreferencedDocs(shas: string[]): Promise<void> {
  if (shas.length === 0) return;
  try {
    await documentsWipeUnreferenced(shas);
  } catch (error) {
    console.warn("documents: unreferenced wipe failed", error);
  }
}

export async function listMcpServers(projectId: string | null): Promise<McpServerRow[]> {
  const db = await getDb();
  const rows = await db.select<(Omit<McpServerRow, "enabled"> & { enabled: number })[]>(
    "SELECT * FROM mcp_servers WHERE project_id IS $1 OR project_id IS NULL ORDER BY name ASC",
    [sqlNull(projectId)],
  );
  return rows.map((row) => ({ ...row, enabled: row.enabled !== 0 }));
}

export async function toggleMcpServer(id: string, enabled: boolean): Promise<void> {
  const db = await getDb();
  await db.execute("UPDATE mcp_servers SET enabled = $1 WHERE id = $2", [
    enabled ? 1 : 0,
    id,
  ]);
}

export async function removeMcpServer(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM mcp_servers WHERE id = $1", [id]);
}

export async function listAuditLogs(search: string, limit = 200): Promise<AuditLog[]> {
  const db = await getDb();
  const term = search.trim();
  const capped = Math.min(Math.max(limit, 1), 500);
  const rows = term
    ? await db.select<unknown[]>(
        "SELECT id, ts, conversation_id, tool, decision, detail, duration_ms, exit_code, source FROM audit_log WHERE tool LIKE $1 ESCAPE '\\' OR decision LIKE $1 ESCAPE '\\' OR detail LIKE $1 ESCAPE '\\' OR source LIKE $1 ESCAPE '\\' ORDER BY ts DESC LIMIT $2",
        [`%${escapeLike(term)}%`, capped],
      )
    : await db.select<unknown[]>(
        "SELECT id, ts, conversation_id, tool, decision, detail, duration_ms, exit_code, source FROM audit_log ORDER BY ts DESC LIMIT $1",
        [capped],
      );
  return rows.flatMap((row) => {
    const parsed = auditLogSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

export async function clearAuditLog(): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM audit_log");
}
