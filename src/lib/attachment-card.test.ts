import { describe, expect, it } from "vitest";

import { docCard, docExtension, formatBytes } from "./attachment-card";

const PDF = {
  kind: "doc" as const,
  name: "quarterly report.pdf",
  mime: "application/pdf",
  sha256: "a".repeat(64),
  size: 240_000,
  chars: 12_345,
};

describe("docCard", () => {
  it("reads the type from the mime type, not the extension", () => {
    const card = docCard(PDF);
    expect(card.typeLabel).toBe("PDF");
    expect(card.extension).toBe("PDF");
  });

  it("falls back to the extension for an unknown mime type", () => {
    const card = docCard({ ...PDF, mime: "application/x-unknown", name: "notes.md" });
    expect(card.typeLabel).toBe("MD");
  });

  it("says File when neither the mime type nor the name says anything", () => {
    const card = docCard({ ...PDF, mime: "application/x-unknown", name: "README" });
    expect(card.typeLabel).toBe("File");
  });

  it("joins size and character count", () => {
    expect(docCard(PDF).meta).toBe("234 KB · 12,345 chars");
  });

  it("does not invent a size it does not have", () => {
    const { size: _size, ...noSize } = PDF;
    expect(docCard({ ...noSize, chars: 40 }).meta).toBe("40 chars");
    const { chars: _chars, ...noChars } = noSize;
    expect(docCard(noChars).meta).toBe("Size unknown");
  });

  it("keeps a long name intact for wrapping in the card", () => {
    const long = `${"a".repeat(180)}.pdf`;
    expect(docCard({ ...PDF, name: long }).name).toBe(long);
  });
});

describe("formatBytes", () => {
  it("scales by unit", () => {
    expect(formatBytes(900)).toBe("900 B");
    expect(formatBytes(240_000)).toBe("234 KB");
    expect(formatBytes(3_500_000)).toBe("3.3 MB");
  });

  it("refuses negative input", () => {
    expect(formatBytes(-1)).toBe("Size unknown");
  });
});

describe("docExtension", () => {
  it("uppercases the last extension", () => {
    expect(docExtension("a.b.final.tsx")).toBe("TSX");
    expect(docExtension("no-extension")).toBe("");
  });
});
