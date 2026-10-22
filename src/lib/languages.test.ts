import { describe, expect, it } from "vitest";

import { normalizeFenceLang } from "./languages";

describe("normalizeFenceLang", () => {
  it("keeps the languages the highlighter already loads", () => {
    expect(normalizeFenceLang("ts")).toBe("typescript");
    expect(normalizeFenceLang("TypeScript")).toBe("typescript");
    expect(normalizeFenceLang(" c++ ")).toBe("cpp");
    expect(normalizeFenceLang("yml")).toBe("yaml");
  });

  it("routes every Airtable script spelling to javascript", () => {
    expect(normalizeFenceLang("script")).toBe("javascript");
    expect(normalizeFenceLang("airtable-script")).toBe("javascript");
    expect(normalizeFenceLang("airscript")).toBe("javascript");
    expect(normalizeFenceLang("apps-script")).toBe("javascript");
    expect(normalizeFenceLang("gs")).toBe("javascript");
  });

  it("gives Airtable formulas their own language", () => {
    expect(normalizeFenceLang("airtable")).toBe("airtable");
    expect(normalizeFenceLang("airtable-formula")).toBe("airtable");
  });

  it("leaves an unknown fence unhighlighted", () => {
    expect(normalizeFenceLang("brainfuck")).toBeNull();
    expect(normalizeFenceLang("")).toBeNull();
  });
});
