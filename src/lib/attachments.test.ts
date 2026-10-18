import { describe, expect, it } from "vitest";

import { parseDocAttachments, parseImageAttachments, parseMessageAttachments } from "./attachments";

const IMAGE = { kind: "image" as const, dataUrl: "data:image/png;base64,AAA" };
const DOC = {
  kind: "doc" as const,
  name: "report.pdf",
  mime: "application/pdf",
  sha256: "a".repeat(64),
  size: 1024,
  chars: 2048,
};

describe("parseMessageAttachments", () => {
  it("returns stored images with their kind filled in", () => {
    const stored = JSON.stringify([{ dataUrl: "data:image/png;base64,AAA" }]);
    expect(parseMessageAttachments(stored)).toEqual([IMAGE]);
  });

  it("returns nothing for absent, empty, or malformed values", () => {
    expect(parseMessageAttachments(null)).toEqual([]);
    expect(parseMessageAttachments(undefined)).toEqual([]);
    expect(parseMessageAttachments("")).toEqual([]);
    expect(parseMessageAttachments("[{}]")).toEqual([]);
    expect(parseMessageAttachments('{"dataUrl":"x"}')).toEqual([]);
    expect(parseMessageAttachments("{ not json")).toEqual([]);
    expect(parseMessageAttachments([{ dataUrl: "x" }])).toEqual([]);
  });

  it("drops values that are not base64 image data", () => {
    expect(parseMessageAttachments('[{"dataUrl":"https://example.com/a.png"}]')).toEqual([]);
    expect(parseMessageAttachments('[{"dataUrl":"data:text/html;base64,AAA"}]')).toEqual([]);
    expect(parseMessageAttachments('[{"dataUrl":"data:image/svg+xml;base64,AAA"}]')).toEqual([]);
    expect(parseMessageAttachments('[{"dataUrl":"data:image/png,plain"}]')).toEqual([]);
    expect(parseMessageAttachments('[{"dataUrl":"javascript:alert(1)"}]')).toEqual([]);
  });

  it("keeps every supported image type", () => {
    const kept = ["png", "jpeg", "webp", "gif"].map((type) => ({
      dataUrl: `data:image/${type};base64,AAAA`,
    }));
    expect(parseMessageAttachments(JSON.stringify(kept))).toEqual(
      kept.map((image) => ({ kind: "image", ...image })),
    );
  });

  it("keeps document references", () => {
    expect(parseMessageAttachments(JSON.stringify([DOC]))).toEqual([DOC]);
  });

  it("drops document references with a bad hash", () => {
    expect(parseMessageAttachments(JSON.stringify([{ ...DOC, sha256: "nope" }]))).toEqual([]);
    expect(parseMessageAttachments(JSON.stringify([{ ...DOC, name: "" }]))).toEqual([]);
    expect(
      parseMessageAttachments(JSON.stringify([{ ...DOC, size: -1 }])),
    ).toEqual([]);
  });

  it("keeps the readable entries when one is broken", () => {
    const stored = JSON.stringify([DOC, { kind: "doc", name: "" }, IMAGE]);
    expect(parseMessageAttachments(stored)).toEqual([DOC, IMAGE]);
  });

  it("keeps every entry of a long list", () => {
    const many = Array.from({ length: 20 }, (_, index) => ({
      dataUrl: `data:image/png;base64,AAAA${index}`,
    }));
    expect(parseMessageAttachments(JSON.stringify(many))).toHaveLength(20);
  });

  it("splits images from documents", () => {
    const stored = JSON.stringify([DOC, { dataUrl: "data:image/png;base64,AAA" }]);
    expect(parseDocAttachments(stored)).toEqual([DOC]);
    expect(parseImageAttachments(stored)).toEqual([IMAGE]);
    expect(parseImageAttachments(JSON.stringify([DOC]))).toEqual([]);
  });

  it("accepts a document without the optional size and chars", () => {
    const stored = JSON.stringify([
      { kind: "doc", name: "notes.md", mime: "text/markdown", sha256: "b".repeat(64) },
    ]);
    expect(parseDocAttachments(stored)).toEqual([
      { kind: "doc", name: "notes.md", mime: "text/markdown", sha256: "b".repeat(64) },
    ]);
  });
});
