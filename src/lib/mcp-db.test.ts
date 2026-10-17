import { beforeAll, describe, expect, it, vi } from "vitest";

import Database from "@tauri-apps/plugin-sql";
import { listMcpServers, removeMcpServer, toggleMcpServer } from "./db";

vi.mock("@tauri-apps/plugin-sql", () => ({
  default: { load: vi.fn() },
}));

const load = vi.mocked(Database.load);

describe("mcp_servers crud", () => {
  const select = vi.fn(async (sql: string, _params: unknown[]) => {
    if (sql.includes("FROM mcp_servers")) {
      return [
        {
          id: "s1",
          project_id: null,
          name: "fs",
          transport: "stdio",
          cmd: "npx srv",
          url: null,
          allow_tools: null,
          deny_tools: null,
          approval_mode: "ask",
          timeout_ms: null,
          enabled: 1,
        },
      ];
    }
    return [];
  });
  const execute = vi.fn(async (_sql: string, _params?: unknown[]) => undefined);

  beforeAll(() => {
    load.mockResolvedValue({ select, execute } as never);
  });

  it("lists servers for the project scope", async () => {
    const rows = await listMcpServers("p1");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.name).toBe("fs");
    expect(select).toHaveBeenCalledWith(expect.stringContaining("FROM mcp_servers"), ["p1"]);
  });

  it("toggles and removes by id", async () => {
    await toggleMcpServer("s1", false);
    expect(execute).toHaveBeenCalledWith("UPDATE mcp_servers SET enabled = $1 WHERE id = $2", [
      0,
      "s1",
    ]);
    await removeMcpServer("s1");
    expect(execute).toHaveBeenCalledWith("DELETE FROM mcp_servers WHERE id = $1", ["s1"]);
  });
});
