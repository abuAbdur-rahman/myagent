import { describe, expect, it } from "vitest";

import { mcpSummary, mcpSummaryText } from "./mcp-summary";

describe("mcpSummary", () => {
  it("counts only enabled servers as connected", () => {
    const summary = mcpSummary(
      [
        { id: "a", enabled: true },
        { id: "b", enabled: false },
      ],
      {
        a: { tools: [{}, {}] },
        b: { tools: [{}] },
      },
    );
    expect(summary).toEqual({ servers: 2, enabled: 1, connected: 1, tools: 2 });
  });

  it("treats a probe with an error as disconnected and counts no tools", () => {
    const summary = mcpSummary([{ id: "a", enabled: true }], {
      a: { error: "spawn failed", tools: [{}] },
    });
    expect(summary.connected).toBe(0);
    expect(summary.tools).toBe(0);
  });

  it("treats a missing probe as disconnected", () => {
    const summary = mcpSummary([{ id: "a", enabled: true }], {});
    expect(summary).toEqual({ servers: 1, enabled: 1, connected: 0, tools: 0 });
  });

  it("handles an empty scope", () => {
    expect(mcpSummaryText(mcpSummary([], {}))).toBe("0 servers · 0 connected");
  });

  it("says tool, not tools, for one", () => {
    expect(mcpSummaryText(mcpSummary([{ id: "a", enabled: true }], { a: { tools: [{}] } }))).toBe(
      "1 server · 1 connected · 1 tool",
    );
  });
});
