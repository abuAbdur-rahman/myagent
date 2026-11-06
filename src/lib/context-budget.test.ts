import { describe, expect, it } from "vitest";

import { buildSystemPrompt } from "./context";
import type { Memory, Project } from "./types";

const base = {
  globalMemories: [],
  project: null,
  projectMemories: [],
};

function memory(id: string, content: string, extra: Partial<Memory> = {}): Memory {
  return {
    id,
    scope: "global",
    project_id: null,
    kind: "note",
    content,
    created_at: 0,
    updated_at: 0,
    ...extra,
  };
}

function project(instructions: string): Project {
  return {
    id: "p1",
    name: "Convert Clicks",
    description: "",
    instructions,
    created_at: 0,
    updated_at: 0,
  };
}

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

  it("appends the skill index after knowledge", () => {
    const system = buildSystemPrompt({
      ...base,
      knowledgeBlock: "## Attached knowledge\n<source name=a.md>hi</source>",
      skillIndexBlock: "## Available skills\n- git-helper: Helps with git work",
    });
    expect(system).toContain("- git-helper: Helps with git work");
    expect((system ?? "").indexOf("Attached knowledge")).toBeLessThan(
      (system ?? "").indexOf("Available skills"),
    );
  });
});

describe("buildSystemPrompt budget", () => {
  it("never cuts project instructions to make room for knowledge", () => {
    const instructions = Array.from({ length: 60 }, (_, index) => `Rule ${index + 1}: always do the thing.`).join("\n");
    const system = buildSystemPrompt({
      ...base,
      project: project(instructions),
      knowledgeBlock: "## Attached knowledge\n" + "z".repeat(9000),
    });
    expect(system).toContain("Rule 60: always do the thing.");
    expect((system ?? "").length).toBeLessThanOrEqual(6000);
  });

  it("keeps whole lines when a block does not fit", () => {
    const system = buildSystemPrompt({
      ...base,
      globalMemories: [memory("a".repeat(32), "prefers pnpm")],
      knowledgeBlock: "## Attached knowledge\n" + "z".repeat(9000) + "\nTAIL-MUST-NOT-APPEAR",
    });
    expect(system).toContain("- (note) prefers pnpm");
    expect(system).not.toContain("TAIL-MUST-NOT-APPEAR");
  });

  it("says what was left out when the data budget overflows", () => {
    const system = buildSystemPrompt({
      ...base,
      knowledgeBlock: "## Attached knowledge\n" + "z".repeat(9000),
      skillIndexBlock: "## Available skills\n" + "s".repeat(4000),
    });
    expect(system).toContain("Context budget reached");
  });

  it("drops untrusted notes instead of sending them as prose", () => {
    const system = buildSystemPrompt({
      ...base,
      globalMemories: [
        memory("b".repeat(32), "the deploy target is Linux", { untrusted: true }),
        memory("c".repeat(32), "the deploy target is Windows"),
      ],
    });
    expect(system).not.toContain("the deploy target is Linux");
    expect(system).toContain("the deploy target is Windows");
  });
});
