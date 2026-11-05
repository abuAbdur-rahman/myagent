import { describe, expect, it } from "vitest";

import { buildSystemPrompt } from "./context";
import type { Memory, Project } from "./types";

const PROJECT_A: Project = {
  id: "pa",
  name: "Agent",
  description: "",
  instructions: "",
  created_at: 0,
  updated_at: 0,
};

const GLOBAL: Memory = {
  id: "g1",
  scope: "global",
  project_id: null,
  kind: "preference",
  content: "Always answer with TypeScript examples.",
  created_at: 0,
  updated_at: 0,
};

const IN_PROJECT_A: Memory = {
  id: "pa1",
  scope: "project",
  project_id: "pa",
  kind: "fact",
  content: "The Agent repo ships Windows only.",
  created_at: 0,
  updated_at: 0,
};

describe("buildSystemPrompt memory scoping", () => {
  it("sends global memory with every chat", () => {
    const system = buildSystemPrompt({
      globalMemories: [GLOBAL],
      project: null,
      projectMemories: [],
    });
    expect(system).toContain("## Durable memory");
    expect(system).toContain("Always answer with TypeScript examples.");
  });

  it("puts project memory under the active project", () => {
    const system = buildSystemPrompt({
      globalMemories: [],
      project: PROJECT_A,
      projectMemories: [IN_PROJECT_A],
    });
    expect(system).toContain("### Project memory");
    expect(system).toContain("The Agent repo ships Windows only.");
  });

  it("does not leak project memory into a chat with no project", () => {
    const system = buildSystemPrompt({
      globalMemories: [GLOBAL],
      project: null,
      projectMemories: [],
    });
    expect(system).not.toContain("The Agent repo ships Windows only.");
    expect(system).not.toContain("Project memory");
  });

  it("adds no memory heading when nothing is saved", () => {
    const system = buildSystemPrompt({
      globalMemories: [],
      project: PROJECT_A,
      projectMemories: [],
    });
    expect(system).not.toContain("Durable memory");
    expect(system).not.toContain("Project memory");
  });
});

describe("buildSystemPrompt relevant memory", () => {
  const RANKED: Memory = {
    id: "r1",
    scope: "project",
    project_id: "pa",
    kind: "note",
    content: "Checkout uses the hosted payment page.",
    created_at: 0,
    updated_at: 0,
  };

  it("adds ranked notes under their own heading", () => {
    const system = buildSystemPrompt({
      globalMemories: [],
      project: PROJECT_A,
      projectMemories: [],
      relevantMemories: [RANKED],
    });
    expect(system).toContain("## Relevant memory for this turn");
    expect(system).toContain("Checkout uses the hosted payment page.");
  });

  it("does not repeat a note that is already sent in full", () => {
    const system = buildSystemPrompt({
      globalMemories: [GLOBAL],
      project: null,
      projectMemories: [],
      relevantMemories: [GLOBAL],
    });
    const hits = system?.match(/Always answer with TypeScript examples\./g) ?? [];
    expect(hits).toHaveLength(1);
    expect(system).not.toContain("## Relevant memory for this turn");
  });

  it("still sends a recalled note that the durable block truncated away", () => {
    const many: Memory[] = Array.from({ length: 30 }, (_, index) => ({
      id: `g${index}`,
      scope: "global" as const,
      project_id: null,
      kind: "note" as const,
      content: `Stored note number ${index}.`,
      created_at: 0,
      updated_at: 0,
    }));
    const truncated = { ...RANKED, id: "g29", content: "Stored note number 29." };
    const system = buildSystemPrompt({
      globalMemories: many,
      project: null,
      projectMemories: [],
      relevantMemories: [truncated],
    });
    expect(system).toContain("## Relevant memory for this turn");
    expect(system).toContain("- (note) Stored note number 29.");
  });

  it("keeps recalled notes when durable memory fills the budget", () => {
    const bulky: Memory[] = Array.from({ length: 24 }, (_, index) => ({
      id: `b${index}`,
      scope: "global" as const,
      project_id: null,
      kind: "note" as const,
      content: `${index}: ${"x".repeat(240)}`,
      created_at: 0,
      updated_at: 0,
    }));
    const system = buildSystemPrompt({
      globalMemories: bulky,
      project: PROJECT_A,
      projectMemories: [],
      relevantMemories: [RANKED],
    });
    expect(system).toContain("## Relevant memory for this turn");
    expect(system).toContain("Checkout uses the hosted payment page.");
    expect(system?.length ?? 0).toBeLessThanOrEqual(6000);
  });
});
