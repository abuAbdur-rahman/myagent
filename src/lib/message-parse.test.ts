import { describe, expect, it } from "vitest";

import { continueDigest } from "./message-parse";
import type { ToolLogEntry } from "./types";

function entry(patch: Partial<ToolLogEntry>): ToolLogEntry {
  return {
    id: patch.id ?? "t1",
    name: patch.name ?? "web_fetch",
    summary: patch.summary ?? "Fetch: https://example.com",
    status: patch.status ?? "ok",
    preview: patch.preview ?? null,
  };
}

describe("continueDigest", () => {
  it("is empty when there is nothing to report", () => {
    expect(continueDigest([])).toBe("");
  });

  it("keeps the newest copy of a repeated call", () => {
    const digest = continueDigest([
      entry({ id: "old", summary: "Fetch: same", preview: "old body" }),
      entry({ id: "other", name: "web_search", summary: "Search: other" }),
      entry({ id: "new", summary: "Fetch: same", preview: "new body" }),
    ]);
    expect(digest).toContain("new body");
    expect(digest).not.toContain("old body");
    expect(digest).toContain("- web_search: Search: other");
  });

  it("puts failed calls under failures, not under already done", () => {
    const digest = continueDigest([
      entry({ id: "ok", status: "ok", summary: "Fetch: good" }),
      entry({ id: "bad", status: "err", summary: "Fetch: bad" }),
    ]);
    const [done, failures] = digest.split("Recent failures");
    expect(done).toContain("Fetch: good");
    expect(done).not.toContain("Fetch: bad");
    expect(failures).toContain("- web_fetch: Fetch: bad");
  });
});
