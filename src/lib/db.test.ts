import { beforeAll, describe, expect, it, vi } from "vitest";

import Database from "@tauri-apps/plugin-sql";
import { documentsWipeUnreferenced, knowledgeSidecarWipe } from "./api";
import {
  addChatDoc,
  clearConversation,
  deleteConversation,
  deleteProject,
  findChatDoc,
  listChatDocs,
  updateMessageAttachments,
} from "./db";

vi.mock("@tauri-apps/plugin-sql", () => ({
  default: { load: vi.fn() },
}));

vi.mock("./api", () => ({
  documentsWipeAll: vi.fn(async () => undefined),
  documentsWipeUnreferenced: vi.fn(async () => 1),
  knowledgeSidecarDelete: vi.fn(async () => undefined),
  knowledgeSidecarWipe: vi.fn(async () => undefined),
  knowledgeSidecarWipeAll: vi.fn(async () => undefined),
}));

const load = vi.mocked(Database.load);
const wipe = vi.mocked(documentsWipeUnreferenced);
const wipeSidecars = vi.mocked(knowledgeSidecarWipe);
const execute = vi.fn(async (_sql: string, _params?: unknown[]) => undefined);
const select = vi.fn(async (sql: string): Promise<unknown[]> => {
  if (sql.includes("FROM chat_docs")) return [{ sha256: "s1" }];
  if (sql.includes("FROM knowledge_docs")) return [{ sha256: "s2" }];
  return [];
});

const chatDocRow = {
  id: "d1",
  conversation_id: "c1",
  name: "report.pdf",
  mime: "application/pdf",
  sha256: "s1",
  path: "documents/s1.txt",
  size: 2048,
  chars: 4096,
};

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
    expect(statements).toContain("DELETE FROM chat_docs WHERE conversation_id = $1");
    expect(statements).toContain("DELETE FROM conversations WHERE id = $1");
  });

  it("keeps project knowledge, which no chat owns", async () => {
    execute.mockClear();
    await deleteConversation("c1");
    const statements = execute.mock.calls.map(([sql]) => sql as string);
    expect(statements.some((sql) => sql.includes("knowledge_docs"))).toBe(false);
  });

  it("frees the stored text the chat pointed at", async () => {
    wipe.mockClear();
    await deleteConversation("c1");
    expect(wipe).toHaveBeenCalledWith(["s1"]);
  });
});

describe("clearConversation", () => {
  it("drops the transcript and its document references", async () => {
    execute.mockClear();
    wipe.mockClear();
    await clearConversation("c1");
    const statements = execute.mock.calls.map(([sql]) => sql as string);
    expect(statements).toContain("DELETE FROM messages WHERE conversation_id = $1");
    expect(statements).toContain("DELETE FROM chat_docs WHERE conversation_id = $1");
    expect(statements).not.toContain("DELETE FROM conversations WHERE id = $1");
    expect(wipe).toHaveBeenCalledWith(["s1"]);
  });
});

describe("deleteProject", () => {
  it("detaches chats, drops knowledge, and frees unreferenced text", async () => {
    execute.mockClear();
    wipe.mockClear();
    wipeSidecars.mockClear();
    await deleteProject("p1");
    const statements = execute.mock.calls.map(([sql]) => sql as string);
    expect(statements).toContain("DELETE FROM knowledge_docs WHERE project_id = $1");
    expect(statements).toContain("DELETE FROM projects WHERE id = $1");
    expect(statements).not.toContain("DELETE FROM messages WHERE conversation_id = $1");
    expect(wipeSidecars).toHaveBeenCalledWith("p1");
    expect(wipe).toHaveBeenCalledWith(["s2"]);
  });
});

describe("chat_docs", () => {
  it("inserts a row for the conversation", async () => {
    execute.mockClear();
    await addChatDoc(chatDocRow);
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO chat_docs"),
      ["d1", "c1", "report.pdf", "application/pdf", "s1", "documents/s1.txt", 2048, 4096, expect.any(Number)],
    );
  });

  it("finds an existing row by hash", async () => {
    select.mockResolvedValueOnce([chatDocRow]);
    expect(await findChatDoc("c1", "s1")).toEqual(chatDocRow);
    select.mockResolvedValueOnce([]);
    expect(await findChatDoc("c1", "s2")).toBeNull();
    expect(select).toHaveBeenCalledWith(
      "SELECT * FROM chat_docs WHERE conversation_id = $1 AND sha256 = $2 LIMIT 1",
      ["c1", "s2"],
    );
  });

  it("lists a conversation's documents", async () => {
    select.mockResolvedValueOnce([chatDocRow]);
    expect(await listChatDocs("c1")).toEqual([chatDocRow]);
    expect(select).toHaveBeenCalledWith(
      "SELECT * FROM chat_docs WHERE conversation_id = $1 ORDER BY created_at ASC",
      ["c1"],
    );
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

  it("stores document references next to images", async () => {
    execute.mockClear();
    await updateMessageAttachments("m1", [
      { kind: "doc", name: "report.pdf", mime: "application/pdf", sha256: "s1" },
      { dataUrl: "data:image/png;base64,AAA" },
    ]);
    expect(execute).toHaveBeenCalledWith(
      "UPDATE messages SET attachments = $1 WHERE id = $2",
      [
        '[{"kind":"doc","name":"report.pdf","mime":"application/pdf","sha256":"s1"},{"dataUrl":"data:image/png;base64,AAA"}]',
        "m1",
      ],
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
