// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";

import { readVisualTheme } from "./theme-prompt";

afterEach(() => {
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-accent");
  document.documentElement.removeAttribute("style");
});

describe("readVisualTheme", () => {
  it("resolves the app accent hue before sending tokens to a sandbox", () => {
    const root = document.documentElement;
    root.dataset.theme = "dark";
    root.dataset.accent = "blue";
    root.style.setProperty("--ah", "255");
    root.style.setProperty("--accent-solid", "oklch(0.55 0.14 var(--ah))");
    root.style.setProperty("--accent-text", "oklch(0.78 0.12 var(--ah))");
    root.style.setProperty("--accent-soft", "oklch(0.7 0.14 var(--ah) / 0.16)");
    root.style.setProperty("--bg-canvas", "var(--preview-bg)");
    root.style.setProperty("--preview-bg", "#123456");

    const theme = readVisualTheme();

    expect(theme.tokens["--myagent-accent"]).toBe("oklch(0.55 0.14 255)");
    expect(theme.tokens["--myagent-accent-text"]).toBe("oklch(0.78 0.12 255)");
    expect(theme.tokens["--myagent-accent-soft"]).toBe("oklch(0.7 0.14 255 / 0.16)");
    expect(theme.tokens["--myagent-bg"]).toBe("#123456");
  });
});
