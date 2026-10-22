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
