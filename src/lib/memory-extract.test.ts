import { describe, expect, it } from "vitest";
import { parseExtractedNotes } from "./memory-extract";

describe("parseExtractedNotes", () => {
  it("reads a plain JSON array", () => {
    expect(parseExtractedNotes('["Likes TypeScript", "Prefers pnpm"]')).toEqual([
      "Likes TypeScript",
      "Prefers pnpm",
    ]);
  });

  it("survives a fenced code block", () => {
    expect(parseExtractedNotes('```json\n["Uses Windows"]\n```')).toEqual(["Uses Windows"]);
  });

  it("drops duplicate and non-string entries", () => {
    expect(parseExtractedNotes('["Same", "same", 42, {"a":1}, "Other"]')).toEqual([
      "Same",
      "Other",
    ]);
  });

  it("collapses whitespace and caps the length", () => {
    const notes = parseExtractedNotes(`["  a\\n\\n b  "]`);
    expect(notes).toEqual(["a b"]);
    const long = parseExtractedNotes(JSON.stringify(["x".repeat(400)]))[0];
    expect(long).toHaveLength(240);
  });

  it("returns at most five notes", () => {
    expect(parseExtractedNotes(JSON.stringify(["1", "2", "3", "4", "5", "6"]))).toHaveLength(5);
  });

  it("returns nothing for unusable output", () => {
    expect(parseExtractedNotes("No durable notes here.")).toEqual([]);
    expect(parseExtractedNotes("[not json]")).toEqual([]);
    expect(parseExtractedNotes("[]")).toEqual([]);
  });
});
