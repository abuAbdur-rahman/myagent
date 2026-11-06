import { describe, expect, it } from "vitest";

import { buildChildSystemPrompt, buildSystemPrompt, clipAtWord } from "./context";
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

  it("keeps durable memory before a skill index that does not fit", () => {
    const system = buildSystemPrompt({
      ...base,
      globalMemories: [memory("d".repeat(32), "prefers pnpm")],
      skillIndexBlock: "## Available skills\n" + "s".repeat(6000),
    });
    expect(system).toContain("prefers pnpm");
    expect(system).not.toContain("Available skills");
  });

  it("keeps the skill index ahead of an attached document", () => {
    const system = buildSystemPrompt({
      ...base,
      skillIndexBlock: "## Available skills\n- git-helper: Helps with git work",
      knowledgeBlock: "## Attached knowledge\n" + "k".repeat(6000),
    });
    expect(system).toContain("- git-helper: Helps with git work");
    expect(system).not.toContain("Attached knowledge");
  });

  it("truncates an oversized single-line instruction at a word, not away", () => {
    const system = buildSystemPrompt({ ...base, standingPrompt: "alpha beta ".repeat(600) });
    expect(system).toContain("alpha beta");
    expect(system).toContain("Instructions over budget");
    expect(system).toContain("…");
    expect((system ?? "").length).toBeLessThanOrEqual(6000);
  });

  it("reports instruction overflow when a single token cannot be cut", () => {
    const system = buildSystemPrompt({ ...base, standingPrompt: "x".repeat(7000) });
    expect(system).toContain("Instructions over budget");
    expect((system ?? "").length).toBeLessThanOrEqual(6000);
  });

  it("never keeps a durable heading without a note", () => {
    const notes = Array.from({ length: 60 }, (_, index) =>
      memory(String(index).padStart(32, "0"), `note ${index} ${"x".repeat(80)}`),
    );
    const system = buildSystemPrompt({
      ...base,
      globalMemories: notes,
      relevantMemories: [memory("r".repeat(32), "the turn needs this")],
    });
    const durable = system?.split("## Durable memory")[1]?.split("\n\n##")[0] ?? "";
    if (durable.length > 0) expect(durable).toContain("- (");
    expect(system).toContain("the turn needs this");
  });

  it("says when durable memory was shortened", () => {
    const notes = Array.from({ length: 6 }, (_, index) =>
      memory(String(index).padStart(32, "0"), `note ${index} ${"y".repeat(900)}`),
    );
    const system = buildSystemPrompt({ ...base, globalMemories: notes });
    expect(system).toContain("durable memory was shortened");
  });
});

describe("buildChildSystemPrompt", () => {
  it("keeps a fitting child prompt whole", () => {
    const system = buildChildSystemPrompt({ project: project("Always answer in English.") });
    expect(system).toContain("Always answer in English.");
  });
});

describe("clipAtWord", () => {
  it("keeps a complete word when the budget ends at its space", () => {
    expect(clipAtWord("alpha beta gamma", 10)).toBe("alpha beta…");
  });

  it("drops only the partial word when the budget ends inside one", () => {
    expect(clipAtWord("alpha beta gamma", 8)).toBe("alpha…");
  });

  it("returns nothing when there is no room", () => {
    expect(clipAtWord("alpha", 0)).toBe("");
  });
});
