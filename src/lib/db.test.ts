import { beforeAll, describe, expect, it, vi } from "vitest";

import Database from "@tauri-apps/plugin-sql";
import { deleteConversation } from "./db";

vi.mock("@tauri-apps/plugin-sql", () => ({
  default: { load: vi.fn() },
}));

const load = vi.mocked(Database.load);

describe("deleteConversation", () => {
  const execute = vi.fn(async (_sql: string, _params?: unknown[]) => undefined);
  const select = vi.fn(async () => []);

  beforeAll(() => {
    load.mockResolvedValue({ select, execute } as never);
  });

  it("removes the chat's own rows", async () => {
    execute.mockClear();
    await deleteConversation("c1");
    const statements = execute.mock.calls.map(([sql]) => sql as string);
    expect(statements).toContain("DELETE FROM messages WHERE conversation_id = $1");
    expect(statements).toContain("DELETE FROM chat_tags WHERE chat_id = $1");
    expect(statements).toContain("DELETE FROM todos WHERE chat_id = $1");
    expect(statements).toContain("DELETE FROM conversations WHERE id = $1");
  });

  it("keeps project knowledge, which no chat owns", async () => {
    execute.mockClear();
    await deleteConversation("c1");
    const statements = execute.mock.calls.map(([sql]) => sql as string);
    expect(statements.some((sql) => sql.includes("knowledge_docs"))).toBe(false);
  });
});
