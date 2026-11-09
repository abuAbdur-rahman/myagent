import { describe, expect, it } from "vitest";

import { groupToolEntries, toolGroupLabel } from "./tool-groups";
import type { ToolLogEntry } from "./types";

function entry(id: string, name: string, summary = id): ToolLogEntry {
  return { id, name, summary, status: "ok", preview: null };
}

describe("groupToolEntries", () => {
  it("keeps a single call as a single row", () => {
    const rows = groupToolEntries([entry("a", "web_search")]);
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("single");
  });

  it("groups only adjacent repeated tools and preserves chronology", () => {
    const rows = groupToolEntries([
      entry("s1", "web_search"),
      entry("m1", "recall_memory"),
      entry("m2", "recall_memory"),
      entry("s2", "web_search"),
      entry("m3", "recall_memory"),
    ]);
    expect(rows.map((row) => (row.kind === "group" ? row.name : row.entry.name))).toEqual([
      "web_search",
      "recall_memory",
      "web_search",
      "recall_memory",
    ]);
    const memories = rows[1];
    expect(memories.kind).toBe("group");
    if (memories.kind === "group") {
      expect(memories.entries.map((item) => item.id)).toEqual(["m1", "m2"]);
      expect(memories.label).toBe("Recalled memories");
    }
  });

  it("gives separated groups of the same tool distinct keys", () => {
    const rows = groupToolEntries([
      entry("s1", "web_search"),
      entry("s2", "web_search"),
      entry("m1", "recall_memory"),
      entry("s3", "web_search"),
      entry("s4", "web_search"),
    ]).filter((row) => row.kind === "group");

    expect(rows.map((row) => row.key)).toEqual(["s1", "s3"]);
  });
});

describe("toolGroupLabel", () => {
  it("uses a readable label and falls back to the tool name", () => {
    expect(toolGroupLabel("web_search")).toBe("Searched the web");
    expect(toolGroupLabel("mcp__github__list_prs")).toBe("Used github / list prs");
  });
});
