import { beforeAll, describe, expect, it, vi } from "vitest";

import Database from "@tauri-apps/plugin-sql";
import { searchMessages } from "./db";

vi.mock("@tauri-apps/plugin-sql", () => ({
  default: { load: vi.fn() },
}));

const load = vi.mocked(Database.load);

describe("searchMessages", () => {
  const select = vi.fn(async (sql: string, _params: unknown[]) => {
    if (sql.includes("c.title LIKE")) return [{ id: "c1", title: "Rust notes" }];
    if (sql.includes("messages_fts MATCH")) {
      return [
        { conversation_id: "c1", message_id: "m1", snippet: "how do async runtimes work" },
      ];
    }
    return [];
  });

  beforeAll(() => {
    load.mockResolvedValue({ select, execute: vi.fn(async () => undefined) } as never);
  });

  it("returns title hit plus FTS hit with snippet for a known phrase", async () => {
    const hits = await searchMessages({ q: "async runtimes" });
    expect(hits[0]).toMatchObject({ conversationId: "c1", messageId: null });
    const body = hits.find((hit) => hit.messageId === "m1");
    expect(body?.snippet).toContain("async");
    const ftsCall = select.mock.calls.find(([sql]) =>
      (sql as string).includes("messages_fts MATCH"),
    );
    expect(ftsCall?.[1]).toContain('"async" "runtimes"');
    expect(ftsCall?.[0] as string).toContain("snippet(messages_fts");
  });

  it("applies pinnedOnly filter to FTS query", async () => {
    await searchMessages({ q: "async", pinnedOnly: true });
    const ftsCalls = select.mock.calls.filter(([sql]) =>
      (sql as string).includes("messages_fts MATCH"),
    );
    const last = ftsCalls[ftsCalls.length - 1]?.[0] as string;
    expect(last).toContain("c.pinned = 1");
  });

  it("rejects an empty query", async () => {
    await expect(searchMessages({ q: "  " })).rejects.toThrow();
  });
});
