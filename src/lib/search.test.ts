import { describe, expect, it } from "vitest";

import { ftsQuery } from "./search";

describe("ftsQuery", () => {
  it("quotes each term and joins with AND", () => {
    expect(ftsQuery("  Async Runtimes ")).toBe('"async" AND "runtimes"');
  });

  it("drops punctuation", () => {
    expect(ftsQuery("what's an async runtime?")).toBe(
      '"what" AND "s" AND "an" AND "async" AND "runtime"',
    );
  });

  it("returns null when nothing is searchable", () => {
    expect(ftsQuery("   ")).toBeNull();
    expect(ftsQuery("?!…")).toBeNull();
  });
});
