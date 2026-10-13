import Database from "@tauri-apps/plugin-sql";
import { newId } from "./utils";
import type {
  Connection,
  ConnectionInput,
  Conversation,
  Memory,
  MemoryInput,
  MemoryKind,
  MemoryScope,
  Message,
  Project,
  ProjectInput,
  Role,
} from "./types";

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

export async function updateConnection(connection: Connection): Promise<void> {
  const db = await getDb();
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

export async function deleteConnection(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM connections WHERE id = $1", [id]);
}

export async function listConversations(): Promise<Conversation[]> {
  const db = await getDb();
  return db.select<Conversation[]>(
    "SELECT * FROM conversations ORDER BY updated_at DESC",
  );
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
  patch: Partial<Pick<Conversation, "title" | "model" | "connection_id" | "project_id">>,
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
  await db.execute("DELETE FROM messages WHERE conversation_id = $1", [id]);
  await db.execute("DELETE FROM conversations WHERE id = $1", [id]);
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
): Promise<Message> {
  const db = await getDb();
  const message: Message = {
    id: newId(),
    conversation_id: conversationId,
    role,
    content,
    created_at: Date.now(),
  };
  await db.execute(
    "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES ($1, $2, $3, $4, $5)",
    [
      message.id,
      message.conversation_id,
      message.role,
      message.content,
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

export async function deleteMessage(id: string): Promise<void> {
  const db = await getDb();
  await db.execute("DELETE FROM messages WHERE id = $1", [id]);
}

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
  await db.execute("DELETE FROM messages WHERE conversation_id = $1", [conversationId]);
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
      "INSERT INTO messages (id, conversation_id, role, content, created_at) VALUES ($1, $2, $3, $4, $5)",
      [newId(), branched.id, m.role, m.content, m.created_at],
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
  await db.execute(
    "DELETE FROM memories WHERE scope = 'project' AND project_id = $1",
    [id],
  );
  await db.execute("UPDATE conversations SET project_id = NULL WHERE project_id = $1", [
    id,
  ]);
  await db.execute("DELETE FROM projects WHERE id = $1", [id]);
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
