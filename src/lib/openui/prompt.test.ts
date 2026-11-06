import { describe, expect, it } from "vitest";

import { buildSystemPrompt, promptBudget } from "../context";
import { OPENUI_SYSTEM_PROMPT } from "./prompt";

describe("OPENUI_SYSTEM_PROMPT", () => {
  it("teaches the root and the fence", () => {
    expect(OPENUI_SYSTEM_PROMPT).toContain("root = Stack");
    expect(OPENUI_SYSTEM_PROMPT).toContain("openui-lang");
    expect(OPENUI_SYSTEM_PROMPT).toContain("BarChart");
    expect(OPENUI_SYSTEM_PROMPT).toContain("FollowUps");
    for (const component of [
      "Stack",
      "Row",
      "Card",
      "Text",
      "Stat",
      "Table",
      "List",
      "Callout",
      "Progress",
      "KeyValue",
      "Code",
      "Button",
    ]) {
      expect(OPENUI_SYSTEM_PROMPT).toContain(component);
    }
  });

  it("stays compact enough for every turn", () => {
    expect(OPENUI_SYSTEM_PROMPT.length).toBeGreaterThan(4_000);
    expect(OPENUI_SYSTEM_PROMPT.length).toBeLessThan(10_000);
  });

  it("fits the default prompt alongside identity instructions", () => {
    const system = buildSystemPrompt({
      globalMemories: [],
      project: null,
      projectMemories: [],
      openuiPrompt: OPENUI_SYSTEM_PROMPT,
      contextLimit: 128_000,
    });
    expect(system).toContain("You are the assistant inside MyAgent");
    expect(system).toContain("root = Stack");
    expect((system ?? "").length).toBeLessThanOrEqual(
      promptBudget(128_000).total + OPENUI_SYSTEM_PROMPT.length + 200,
    );
  });
});
