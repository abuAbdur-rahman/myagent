import Database from "@tauri-apps/plugin-sql";
import { newId } from "./utils";
import type {
  Connection,
  ConnectionInput,
  Conversation,
  Message,
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
): Promise<Conversation> {
  const db = await getDb();
  const now = Date.now();
  const conversation: Conversation = {
    id: newId(),
    title: "New chat",
    connection_id: connectionId,
    model,
    created_at: now,
    updated_at: now,
  };
  await db.execute(
    "INSERT INTO conversations (id, title, connection_id, model, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [
      conversation.id,
      conversation.title,
      conversation.connection_id,
      conversation.model,
      conversation.created_at,
      conversation.updated_at,
    ],
  );
  return conversation;
}

export async function touchConversation(
  id: string,
  patch: Partial<Pick<Conversation, "title" | "model" | "connection_id">>,
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
