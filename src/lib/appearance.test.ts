import { describe, expect, it } from "vitest";

import {
  DEFAULT_APPEARANCE,
  clampFontScale,
  densityLabel,
  fontScaleLabel,
  parseDensity,
  parseFontScale,
  parseGroupByDate,
} from "./appearance";

describe("appearance prefs", () => {
  it("falls back to every default when nothing is stored", () => {
    expect(parseFontScale(null)).toBe(DEFAULT_APPEARANCE.fontScale);
    expect(parseDensity(null)).toBe(DEFAULT_APPEARANCE.density);
    expect(parseGroupByDate(null)).toBe(DEFAULT_APPEARANCE.groupByDate);
  });

  it("reads back what was stored, so a restart keeps the choice", () => {
    expect(parseFontScale("1.1")).toBe(1.1);
    expect(parseDensity("compact")).toBe("compact");
    expect(parseGroupByDate("0")).toBe(false);
    expect(parseGroupByDate("1")).toBe(true);
  });

  it("ignores a corrupted value instead of shrinking the UI to nothing", () => {
    expect(parseFontScale("wide")).toBe(DEFAULT_APPEARANCE.fontScale);
    expect(parseFontScale("0")).toBe(DEFAULT_APPEARANCE.fontScale);
    expect(parseFontScale("-3")).toBe(DEFAULT_APPEARANCE.fontScale);
    expect(parseFontScale("9")).toBe(1.2);
    expect(parseDensity("spacious")).toBe("comfortable");
  });

  it("clamps the slider to a readable range", () => {
    expect(clampFontScale(0.5)).toBe(0.9);
    expect(clampFontScale(4)).toBe(1.2);
    expect(clampFontScale(1.004)).toBe(1);
  });

  it("labels the scale in the base size the UI actually uses", () => {
    expect(fontScaleLabel(1)).toBe("14 px");
    expect(fontScaleLabel(1.2)).toBe("17 px");
    expect(densityLabel("compact")).toBe("Compact");
    expect(densityLabel("comfortable")).toBe("Comfortable");
  });
});
