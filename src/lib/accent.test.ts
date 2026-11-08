import { describe, expect, it } from "vitest";
import { ACCENT_PRESETS, accentIdOf, accentLabel, accentSwatch, parseAccent } from "./accent";

describe("accent", () => {
  it("migrates legacy hex values to preset ids", () => {
    expect(parseAccent("#c96442")).toBe("clay");
    expect(parseAccent("#0067C0")).toBe("blue");
    expect(parseAccent("#5c5c5c")).toBe("graphite");
  });

  it("keeps known ids and falls back to clay", () => {
    expect(parseAccent("violet")).toBe("violet");
    expect(parseAccent("nope")).toBe("clay");
    expect(parseAccent(null)).toBe("clay");
  });

  it("normalises arbitrary values", () => {
    expect(accentIdOf("  PINK ")).toBe("pink");
    expect(accentIdOf("#7a42d6")).toBe("violet");
    expect(accentIdOf("#123456")).toBe("clay");
    expect(accentIdOf("constructor")).toBe("clay");
    expect(accentIdOf("__proto__")).toBe("clay");
  });

  it("labels and swatches every preset", () => {
    for (const preset of ACCENT_PRESETS) {
      expect(accentLabel(preset.id)).toBe(preset.label);
      expect(accentSwatch(preset.id)).toMatch(/^oklch\(/);
    }
    expect(accentLabel("missing")).toBe("Clay");
    expect(accentSwatch("graphite")).toBe("oklch(0.45 0.012 80)");
  });
});
