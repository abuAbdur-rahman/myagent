import { describe, expect, it } from "vitest";

import { buildSystemPrompt } from "./context";

const base = {
  globalMemories: [],
  project: null,
  projectMemories: [],
};

describe("buildSystemPrompt knowledge block", () => {
  it("appends the knowledge block after project context", () => {
    const system = buildSystemPrompt({
      ...base,
      knowledgeBlock: "## Attached knowledge\n<source name=a.md>hi</source>",
    });
    expect(system).toContain("<source name=a.md>hi</source>");
  });

  it("omits the block when empty", () => {
    const system = buildSystemPrompt({ ...base, knowledgeBlock: "" });
    expect(system).not.toContain("Attached knowledge");
  });

  it("keeps total output inside the char cap", () => {
    const big = "## Attached knowledge\n" + "y".repeat(9000);
    const system = buildSystemPrompt({ ...base, knowledgeBlock: big });
    expect((system ?? "").length).toBeLessThanOrEqual(6000);
  });
});
