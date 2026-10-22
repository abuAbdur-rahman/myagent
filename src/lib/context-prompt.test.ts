import { describe, expect, it } from "vitest";

import { buildSystemPrompt } from "./context";
import type { Memory, Project } from "./types";

const PROJECT: Project = {
  id: "p1",
  name: "Agent",
  description: "A Windows desktop chat client.",
  instructions: "Prefer Rust for the backend.",
  created_at: 0,
  updated_at: 0,
};

const MEMORY: Memory = {
  id: "m1",
  scope: "global",
  project_id: null,
  kind: "preference",
  content: "Always answer with TypeScript examples.",
  created_at: 0,
  updated_at: 0,
};

const base = {
  globalMemories: [] as Memory[],
  project: null as Project | null,
  projectMemories: [] as Memory[],
};

describe("buildSystemPrompt instruction order", () => {
  it("runs standing instructions before the project block and the chat block", () => {
    const system = buildSystemPrompt({
      ...base,
      project: PROJECT,
      standingPrompt: "Answer in TypeScript.",
      chatPrompt: "This chat is a code review.",
    }) ?? "";
    const standing = system.indexOf("## Standing instructions");
    const project = system.indexOf("## Project: Agent");
    const chat = system.indexOf("## This chat");
    expect(standing).toBeGreaterThan(-1);
    expect(project).toBeGreaterThan(standing);
    expect(chat).toBeGreaterThan(project);
  });

  it("keeps the chat block last even with memory in the prompt", () => {
    const system = buildSystemPrompt({
      ...base,
      globalMemories: [MEMORY],
      project: PROJECT,
      chatPrompt: "Stay terse.",
    }) ?? "";
    expect(system.indexOf("## Durable memory")).toBeLessThan(system.indexOf("## This chat"));
    expect(system.lastIndexOf("## This chat")).toBeGreaterThan(
      system.indexOf("### Project instructions"),
    );
  });

  it("adds no block when a prompt is blank", () => {
    const system = buildSystemPrompt({
      ...base,
      standingPrompt: "   ",
      chatPrompt: "",
    });
    expect(system).not.toContain("Standing instructions");
    expect(system).not.toContain("This chat");
  });

  it("sends the chat prompt without any project or memory", () => {
    const system = buildSystemPrompt({ ...base, chatPrompt: "Only this chat matters." });
    expect(system).toContain("## This chat\nOnly this chat matters.");
  });

  it("keeps the whole prompt inside the character cap", () => {
    const system = buildSystemPrompt({
      ...base,
      standingPrompt: "s".repeat(5000),
      chatPrompt: "c".repeat(5000),
    });
    expect((system ?? "").length).toBeLessThanOrEqual(6000);
  });
});
