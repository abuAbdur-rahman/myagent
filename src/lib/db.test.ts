import { beforeAll, describe, expect, it, vi } from "vitest";

import Database from "@tauri-apps/plugin-sql";
import {
  deleteConversation,
  parseMessageAttachments,
  updateMessageAttachments,
} from "./db";

vi.mock("@tauri-apps/plugin-sql", () => ({
  default: { load: vi.fn() },
}));

const load = vi.mocked(Database.load);
const execute = vi.fn(async (_sql: string, _params?: unknown[]) => undefined);
const select = vi.fn(async () => []);

beforeAll(() => {
  load.mockResolvedValue({ select, execute } as never);
});

describe("deleteConversation", () => {
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

describe("parseMessageAttachments", () => {
  it("returns the stored images", () => {
    const stored = JSON.stringify([{ dataUrl: "data:image/png;base64,AAA" }]);
    expect(parseMessageAttachments(stored)).toEqual([
      { dataUrl: "data:image/png;base64,AAA" },
    ]);
  });

  it("returns nothing for absent, empty, or malformed values", () => {
    expect(parseMessageAttachments(null)).toEqual([]);
    expect(parseMessageAttachments(undefined)).toEqual([]);
    expect(parseMessageAttachments("")).toEqual([]);
    expect(parseMessageAttachments("[{}]")).toEqual([]);
    expect(parseMessageAttachments('{"dataUrl":"x"}')).toEqual([]);
    expect(parseMessageAttachments("{ not json")).toEqual([]);
  });
});

describe("updateMessageAttachments", () => {
  it("stores images as json", async () => {
    execute.mockClear();
    await updateMessageAttachments("m1", [{ dataUrl: "data:image/png;base64,AAA" }]);
    expect(execute).toHaveBeenCalledWith(
      "UPDATE messages SET attachments = $1 WHERE id = $2",
      ['[{"dataUrl":"data:image/png;base64,AAA"}]', "m1"],
    );
  });

  it("clears the column when there is nothing to store", async () => {
    execute.mockClear();
    await updateMessageAttachments("m1", []);
    expect(execute).toHaveBeenCalledWith(
      "UPDATE messages SET attachments = $1 WHERE id = $2",
      [null, "m1"],
    );
  });
});
