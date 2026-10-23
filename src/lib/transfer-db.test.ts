import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import Database from "@tauri-apps/plugin-sql";
import { exportBundle, importBundle } from "./db";

vi.mock("@tauri-apps/plugin-sql", () => ({
  default: { load: vi.fn() },
}));

vi.mock("./api", () => ({
  documentsWipeAll: vi.fn(async () => undefined),
  documentsWipeUnreferenced: vi.fn(async () => 0),
  knowledgeSidecarWipeAll: vi.fn(async () => undefined),
}));

const load = vi.mocked(Database.load);

const project = {
  id: "p1",
  name: "Work",
  description: "",
  instructions: "",
  created_at: 1,
  updated_at: 2,
};

const conversation = {
  id: "c1",
  title: "Weekly plan",
  connection_id: "conn-1",
  project_id: "p1",
  pinned: 0,
  compacted: 0,
  model: "deepseek-chat",
  summary: null,
  summary_through: null,
  system_prompt: null,
  created_at: 3,
  updated_at: 4,
};

const message = {
  id: "m1",
  conversation_id: "c1",
  role: "user" as const,
  content: "hello",
  created_at: 5,
};

const globalMemory = {
  id: "g1",
  scope: "global" as const,
  project_id: null,
  kind: "fact" as const,
  content: "Prefers short answers",
  created_at: 6,
  updated_at: 6,
};

const projectMemory = {
  id: "pm1",
  scope: "project" as const,
  project_id: "p1",
  kind: "note" as const,
  content: "Uses staging first",
  created_at: 7,
  updated_at: 7,
};

const select = vi.fn(async (sql: string, _params?: unknown[]): Promise<unknown[]> => {
  if (sql.includes("FROM projects")) return [project];
  if (sql.includes("FROM conversations ORDER BY")) return [conversation];
  if (sql.includes("FROM messages WHERE conversation_id")) return [message];
  if (sql.includes("FROM memories")) {
    return sql.includes("project_id") ? [projectMemory] : [globalMemory];
  }
  return [];
});

const execute = vi.fn(async (_sql: string, _params?: unknown[]) => ({ rowsAffected: 1 }));

beforeAll(() => {
  load.mockResolvedValue({ select, execute } as never);
});

beforeEach(() => {
  select.mockClear();
  execute.mockClear();
});

describe("exportBundle", () => {
  it("exports chats and projects without memory", async () => {
    const bundle = await exportBundle("chats");
    expect(bundle.scope).toBe("chats");
    expect(bundle.conversations).toHaveLength(1);
    expect(bundle.conversations[0].messages).toHaveLength(1);
    expect(bundle.projects.map((row) => row.id)).toEqual(["p1"]);
    expect(bundle.memories).toEqual([]);
  });

  it("exports memory and projects without conversations", async () => {
    const bundle = await exportBundle("memory");
    expect(bundle.conversations).toEqual([]);
    expect(bundle.projects.map((row) => row.id)).toEqual(["p1"]);
    expect(bundle.memories.map((row) => row.id).sort()).toEqual(["g1", "pm1"]);
    expect(select.mock.calls.some(([sql]) => sql.includes("FROM conversations ORDER BY"))).toBe(
      false,
    );
  });
});

describe("importBundle", () => {
  it("rejects a file whose conversations are not a list", async () => {
    await expect(importBundle({ conversations: "nope" })).rejects.toThrow();
  });

  it("imports a project, a chat and its memory and nulls the lost connection", async () => {
    const report = await importBundle({
      version: 1,
      conversations: [{ ...conversation, messages: [message] }],
      projects: [project],
      memories: [globalMemory, projectMemory],
    });
    expect(report).toEqual({
      projects: 1,
      conversations: 1,
      messages: 1,
      memories: 2,
      skippedConversations: 0,
      skippedMemories: 0,
    });
    const chatInsert = execute.mock.calls.find(([sql]) => sql.includes("INTO conversations"));
    expect(chatInsert?.[1]?.[2]).toBeNull();
    expect(chatInsert?.[1]?.[3]).toBe("p1");
  });

  it("skips a chat that is already here", async () => {
    select.mockImplementation(async (sql: string) => {
      if (sql.includes("FROM conversations WHERE id")) return [{ id: "c1" }];
      if (sql.includes("FROM projects")) return [{ id: "p1" }];
      return [];
    });
    const report = await importBundle({
      conversations: [{ ...conversation, messages: [message] }],
    });
    expect(report.skippedConversations).toBe(1);
    expect(report.conversations).toBe(0);
    expect(execute.mock.calls.some(([sql]) => sql.includes("INTO messages"))).toBe(false);
  });

  it("drops a project memory whose project is missing", async () => {
    select.mockImplementation(async () => []);
    const report = await importBundle({ memories: [projectMemory] });
    expect(report.memories).toBe(0);
    expect(report.skippedMemories).toBe(1);
    expect(execute.mock.calls.some(([sql]) => sql.includes("INTO memories"))).toBe(false);
  });

  it("accepts the older export shape with global and per-project memory", async () => {
    select.mockImplementation(async (sql: string) =>
      sql.includes("FROM projects") ? [{ id: "p1" }] : [],
    );
    const report = await importBundle({
      conversations: [],
      projects: [project],
      globalMemories: [globalMemory],
      projectMemories: [{ project, memories: [projectMemory] }],
    });
    expect(report.memories).toBe(2);
  });
});
