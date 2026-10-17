import { beforeAll, describe, expect, it, vi } from "vitest";

import Database from "@tauri-apps/plugin-sql";
import { clearAuditLog, listAuditLogs, wipeAll } from "./db";

vi.mock("@tauri-apps/plugin-sql", () => ({
  default: { load: vi.fn() },
}));

vi.mock("./api", () => ({
  knowledgeSidecarWipeAll: vi.fn(),
}));

const load = vi.mocked(Database.load);

const rows = [
  { id: "a1", ts: 9, conversation_id: "c1", tool: "web_fetch", decision: "once", detail: "x.com" },
  { id: "a2", ts: 5, conversation_id: null, tool: "shell", decision: "deny(user)", detail: null },
];

const select = vi.fn(async (sql: string, _params: unknown[]) =>
  sql.includes("LIKE") ? [rows[0]] : rows,
);
const execute = vi.fn(async (_sql: string, _params?: unknown[]) => undefined);

beforeAll(() => {
  load.mockResolvedValue({ select, execute } as never);
});

describe("audit log reader", () => {
  it("returns parsed rows newest first", async () => {
    const all = await listAuditLogs("", 200);
    expect(all.map((r) => r.id)).toEqual(["a1", "a2"]);
    expect(select).toHaveBeenCalledWith(expect.stringContaining("ORDER BY ts DESC"), [200]);
  });

  it("filters with a LIKE term", async () => {
    const hits = await listAuditLogs("web", 50);
    expect(hits).toHaveLength(1);
    expect(select).toHaveBeenCalledWith(expect.stringContaining("LIKE $1"), ["%web%", 50]);
  });

  it("escapes LIKE wildcards in the search term", async () => {
    select.mockClear();
    await listAuditLogs("100%_x", 50);
    expect(select).toHaveBeenCalledWith(expect.stringContaining("ESCAPE '\\'"), [
      "%100\\%\\_x%",
      50,
    ]);
  });

  it("clears all rows", async () => {
    execute.mockClear();
    await clearAuditLog();
    expect(execute).toHaveBeenCalledWith("DELETE FROM audit_log");
  });
});

describe("wipeAll", () => {
  it("clears audit_log, permission_rules and mcp_servers", async () => {
    execute.mockClear();
    await wipeAll();
    const sqls = execute.mock.calls.map((call) => call[0]);
    expect(sqls).toContain("DELETE FROM audit_log");
    expect(sqls).toContain("DELETE FROM permission_rules");
    expect(sqls).toContain("DELETE FROM mcp_servers");
  });
});
