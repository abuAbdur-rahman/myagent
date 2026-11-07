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

  it("groups repeated tools and preserves first-seen order", () => {
    const rows = groupToolEntries([
      entry("s1", "web_search"),
      entry("f1", "web_fetch"),
      entry("s2", "web_search"),
      entry("s3", "web_search"),
    ]);
    expect(rows.map((row) => (row.kind === "group" ? row.name : row.entry.name))).toEqual([
      "web_search",
      "web_fetch",
    ]);
    const search = rows[0];
    expect(search.kind).toBe("group");
    if (search.kind === "group") {
      expect(search.entries.map((item) => item.id)).toEqual(["s1", "s2", "s3"]);
      expect(search.label).toBe("Searched the web");
    }
  });
});

describe("toolGroupLabel", () => {
  it("uses a readable label and falls back to the tool name", () => {
    expect(toolGroupLabel("web_search")).toBe("Searched the web");
    expect(toolGroupLabel("mcp__github__list_prs")).toBe("Used github / list prs");
  });
});
