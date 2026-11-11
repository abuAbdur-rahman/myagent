import { describe, expect, it } from "vitest";

import type { VisualTheme } from "./theme-prompt";
import { readVisualTheme, visualThemePrompt } from "./theme-prompt";

const theme: VisualTheme = {
  mode: "light",
  accentId: "blue",
  accentLabel: "Blue",
  tokens: {
    "--myagent-bg": "#faf9f6",
    "--myagent-card": "#ffffff",
    "--myagent-fg": "#1f1d1a",
    "--myagent-muted": "#5d5953",
    "--myagent-border": "rgba(40, 30, 10, 0.13)",
    "--myagent-accent": "oklch(0.55 0.14 255)",
    "--myagent-radius": "12px",
  },
};

describe("visualThemePrompt", () => {
  it("names every token the visual frame receives", () => {
    const prompt = visualThemePrompt(theme);
    for (const token of Object.keys(theme.tokens)) {
      expect(prompt).toContain(token);
    }
  });

  it("states the current mode and accent", () => {
    const prompt = visualThemePrompt(theme);
    expect(prompt).toContain("light mode");
    expect(prompt).toContain("Blue accent");
  });

  it("forbids a second palette and hardcoded light surfaces", () => {
    const prompt = visualThemePrompt(theme);
    expect(prompt).toContain("Never hardcode #fff, #000");
    expect(prompt).toContain("a second palette");
  });

  it("falls back to a dark clay theme without a DOM", () => {
    const fallback = readVisualTheme();
    expect(fallback.mode).toBe("dark");
    expect(fallback.accentLabel).toBe("Clay");
    expect(fallback.tokens["--myagent-accent"]).toContain("oklch");
    expect(fallback.tokens["--myagent-font"]).toContain("Segoe UI");
  });

  it("uses an explicit selection before DOM attributes are applied", () => {
    const selected = readVisualTheme({ mode: "light", accentId: "blue" });
    expect(selected.mode).toBe("light");
    expect(selected.accentLabel).toBe("Blue");
    expect(selected.tokens["--myagent-bg"]).toBe("#faf9f6");
    expect(selected.tokens["--myagent-accent"]).toContain("255");
  });
});
