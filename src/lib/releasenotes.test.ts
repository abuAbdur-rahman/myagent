import { describe, expect, it } from "vitest";
import {
  CHANGE_KINDS,
  RELEASES,
  changeCount,
  changeCountLabel,
  filterReleases,
  matchesKinds,
  releaseHasKind,
  type Release,
} from "./releasenotes";

const release = (version: string, kinds: ("new" | "improved" | "fixed")[]): Release => ({
  version,
  date: "2026-01-01",
  summary: "summary",
  changes: kinds.map((kind) => ({ kind, text: `${kind} change` })),
});

const versions = (releases: Release[]) => releases.map((item) => item.version);

describe("RELEASES", () => {
  it("lists each version once", () => {
    expect(new Set(versions([...RELEASES])).size).toBe(RELEASES.length);
  });

  it("orders releases newest first", () => {
    const parts = RELEASES.map((item) => item.version.split(".").map(Number));
    for (let i = 1; i < parts.length; i += 1) {
      const previous = parts[i - 1];
      const current = parts[i];
      const older =
        previous[0] > current[0] ||
        (previous[0] === current[0] &&
          (previous[1] > current[1] || (previous[1] === current[1] && previous[2] > current[2])));
      expect(older).toBe(true);
    }
  });

  it("gives every release a parseable date and at least one change", () => {
    for (const item of RELEASES) {
      expect(item.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(item.date))).toBe(false);
      expect(changeCount(item)).toBeGreaterThan(0);
    }
  });

  it("uses only known change kinds", () => {
    for (const item of RELEASES) {
      for (const change of item.changes) {
        expect(CHANGE_KINDS).toContain(change.kind);
        expect(change.text.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("changeCountLabel", () => {
  it("uses the singular for one change", () => {
    expect(changeCountLabel(release("1.0.0", ["new"]))).toBe("1 change");
  });

  it("uses the plural for several changes", () => {
    expect(changeCountLabel(release("1.0.0", ["new", "fixed"]))).toBe("2 changes");
  });
});

describe("releaseHasKind", () => {
  it("finds a kind the release carries", () => {
    expect(releaseHasKind(release("1.0.0", ["new", "fixed"]), "fixed")).toBe(true);
  });

  it("misses a kind the release does not carry", () => {
    expect(releaseHasKind(release("1.0.0", ["new"]), "improved")).toBe(false);
  });
});

describe("matchesKinds", () => {
  it("matches every release when nothing is selected", () => {
    expect(matchesKinds(release("1.0.0", ["fixed"]), [])).toBe(true);
  });

  it("matches when any selected kind is present", () => {
    expect(matchesKinds(release("1.0.0", ["improved"]), ["new", "improved"])).toBe(true);
  });

  it("misses when no selected kind is present", () => {
    expect(matchesKinds(release("1.0.0", ["improved"]), ["new", "fixed"])).toBe(false);
  });
});

describe("filterReleases", () => {
  const releases = [release("2.0.0", ["new"]), release("1.0.0", ["fixed"]), release("0.9.0", ["new", "fixed"])];

  it("returns everything when nothing is selected", () => {
    expect(versions(filterReleases(releases, []))).toEqual(["2.0.0", "1.0.0", "0.9.0"]);
  });

  it("keeps only releases carrying a selected kind, in order", () => {
    expect(versions(filterReleases(releases, ["fixed"]))).toEqual(["1.0.0", "0.9.0"]);
  });

  it("unions several selected kinds", () => {
    expect(versions(filterReleases(releases, ["new", "fixed"]))).toEqual(["2.0.0", "1.0.0", "0.9.0"]);
  });

  it("returns nothing when no release matches", () => {
    expect(filterReleases(releases, ["improved"])).toEqual([]);
  });

  it("does not mutate the input", () => {
    const copy = [...releases];
    filterReleases(releases, ["new"]);
    expect(releases).toEqual(copy);
  });
});
