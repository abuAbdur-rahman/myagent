import { describe, expect, it } from "vitest";

import { OPENUI_SYSTEM_PROMPT } from "./prompt";

describe("OPENUI_SYSTEM_PROMPT", () => {
  it("teaches the root and the fence", () => {
    expect(OPENUI_SYSTEM_PROMPT).toContain("root = Stack");
    expect(OPENUI_SYSTEM_PROMPT).toContain("openui-lang");
    expect(OPENUI_SYSTEM_PROMPT).toContain("BarChart");
    expect(OPENUI_SYSTEM_PROMPT).toContain("FollowUps");
  });

  it("stays compact enough for every turn", () => {
    expect(OPENUI_SYSTEM_PROMPT.length).toBeGreaterThan(4_000);
    expect(OPENUI_SYSTEM_PROMPT.length).toBeLessThan(10_000);
  });
});
