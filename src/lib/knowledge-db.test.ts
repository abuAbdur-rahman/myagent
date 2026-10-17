import { beforeAll, describe, expect, it, vi } from "vitest";

import Database from "@tauri-apps/plugin-sql";
import { knowledgeSidecarWipeAll } from "./api";
import {
  addKnowledgeDoc,
  deleteKnowledgeDoc,
  knowledgeShaExists,
  listKnowledgeDocs,
  wipeAll,
} from "./db";

vi.mock("@tauri-apps/plugin-sql", () => ({
  default: { load: vi.fn() },
}));

vi.mock("./api", () => ({
  knowledgeSidecarWipeAll: vi.fn(),
}));

const wipeSidecars = vi.mocked(knowledgeSidecarWipeAll);

const load = vi.mocked(Database.load);

describe("knowledge_docs crud", () => {
  const select = vi.fn(async (sql: string, params: unknown[]) => {
    if (sql.includes("WHERE project_id = $1 AND sha256"))
      return params[1] === "known" ? [{ id: "k1" }] : [];
    if (sql.includes("FROM knowledge_docs")) {
      return [
        {
          id: "k1",
          project_id: "p1",
          chat_id: null,
          name: "notes.md",
          mime: "text/markdown",
          sha256: "known",
          path: "knowledge/p1/known.txt",
          size: 5,
          created_at: 1,
        },
      ];
    }
    return [];
  });
  const execute = vi.fn(async (_sql: string, _params?: unknown[]) => undefined);

  beforeAll(() => {
    load.mockResolvedValue({ select, execute } as never);
  });

  it("detects an ingested sha within a project", async () => {
    expect(await knowledgeShaExists("p1", "known")).toBe(true);
    expect(await knowledgeShaExists("p1", "fresh")).toBe(false);
  });

  it("inserts a row with the sidecar pointer", async () => {
    await addKnowledgeDoc({
      id: "k1",
      project_id: "p1",
      chat_id: null,
      name: "notes.md",
      mime: "text/markdown",
      sha256: "known",
      path: "knowledge/p1/known.txt",
      size: 5,
    });
    const insert = execute.mock.calls.find(([sql]) =>
      (sql as string).includes("INSERT INTO knowledge_docs"),
    );
    expect(insert?.[1]).toContain("known");
  });

  it("lists project docs with a name prefilter", async () => {
    const rows = await listKnowledgeDocs("p1", "notes");
    expect(rows).toHaveLength(1);
    expect(select).toHaveBeenCalledWith(expect.stringContaining("name LIKE"), [
      "p1",
      "%notes%",
    ]);
  });

  it("deletes a doc row", async () => {
    await deleteKnowledgeDoc("k1");
    expect(execute).toHaveBeenCalledWith("DELETE FROM knowledge_docs WHERE id = $1", [
      "k1",
    ]);
  });

  it("wipeAll clears knowledge_docs and sidecars", async () => {
    execute.mockClear();
    await wipeAll();
    const wiped = execute.mock.calls.some(([sql]) =>
      (sql as string).includes("DELETE FROM knowledge_docs"),
    );
    expect(wiped).toBe(true);
    expect(wipeSidecars).toHaveBeenCalledOnce();
  });
});
