import { describe, expect, it } from "vitest";

import { SETTINGS_INDEX } from "./settings-index";
import {
  resolveSettingsPage,
  SETTINGS_PAGES,
  SETTINGS_SUBTITLES,
} from "./settings-pages";

const ids = SETTINGS_PAGES.map((page) => page.id);

describe("settings pages", () => {
  it("gives every page a subtitle, so a new page cannot ship as a bare list", () => {
    expect(Object.keys(SETTINGS_SUBTITLES).sort()).toEqual([...ids].sort());
    for (const page of SETTINGS_PAGES) {
      expect(SETTINGS_SUBTITLES[page.id].length).toBeGreaterThan(20);
    }
  });

  it("names every page in the search index", () => {
    const indexed = new Set(SETTINGS_INDEX.map((entry) => entry.page));
    for (const id of ids) {
      expect(indexed.has(id)).toBe(true);
    }
  });

  it("points no search term at a page that does not exist", () => {
    for (const entry of SETTINGS_INDEX) {
      expect(ids).toContain(entry.page);
      expect(entry.term.trim().length).toBeGreaterThan(0);
    }
  });

  it("resolves an unknown or empty page to General", () => {
    expect(resolveSettingsPage("providers")).toBe("providers");
    expect(resolveSettingsPage("nope")).toBe("general");
    expect(resolveSettingsPage(null)).toBe("general");
  });

  it("keeps page ids unique and kebab-cased", () => {
    expect(new Set(ids).size).toBe(ids.length);
    const kebab = /^[a-z]+(-[a-z]+)*$/;
    for (const id of ids) {
      expect(id).toMatch(kebab);
    }
  });
});
