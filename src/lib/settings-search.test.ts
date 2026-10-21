import { describe, expect, it } from "vitest";

import { hitKey, searchSettings, type SettingsEntry } from "./settings-search";

const PAGES = [
  { id: "general", label: "General" },
  { id: "models", label: "Models" },
  { id: "search", label: "Search" },
];

const INDEX: SettingsEntry[] = [
  { page: "general", term: "Auto-compact context" },
  { page: "general", term: "Display name" },
  { page: "models", term: "Default model" },
  { page: "models", term: "Vision fallback model" },
  { page: "search", term: "Tavily API keys" },
  { page: "ghost", term: "Orphan row" },
];

describe("searchSettings", () => {
  it("returns nothing for a blank query", () => {
    expect(searchSettings(PAGES, INDEX, "   ")).toEqual([]);
  });

  it("matches a page label before any row", () => {
    const hits = searchSettings(PAGES, INDEX, "models");
    expect(hits[0]).toEqual({ page: "models", pageLabel: "Models", term: null });
  });

  it("maps a row hit to its page and keeps the page label", () => {
    const hits = searchSettings(PAGES, INDEX, "compact");
    expect(hits).toEqual([
      { page: "general", pageLabel: "General", term: "Auto-compact context" },
    ]);
  });

  it("is case-insensitive and ignores surrounding space", () => {
    expect(searchSettings(PAGES, INDEX, "  TAVILY ")[0]?.term).toBe("Tavily API keys");
  });

  it("ranks a prefix match above a substring match", () => {
    const hits = searchSettings(PAGES, INDEX, "model");
    const terms = hits.filter((hit) => hit.term).map((hit) => hit.term);
    expect(terms).toEqual(["Default model", "Vision fallback model"]);
  });

  it("drops rows that point at a page that no longer exists", () => {
    expect(searchSettings(PAGES, INDEX, "orphan")).toEqual([]);
  });

  it("caps the list", () => {
    const many: SettingsEntry[] = Array.from({ length: 30 }, (_, index) => ({
      page: "general",
      term: `Setting ${index}`,
    }));
    expect(searchSettings(PAGES, many, "setting")).toHaveLength(12);
  });
});

describe("hitKey", () => {
  it("separates a page hit from a row hit on the same page", () => {
    expect(hitKey({ page: "general", pageLabel: "General", term: null })).not.toBe(
      hitKey({ page: "general", pageLabel: "General", term: "Theme" }),
    );
  });

  it("is empty for a missing hit", () => {
    expect(hitKey(undefined)).toBe("");
  });
});
