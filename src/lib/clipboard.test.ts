// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { clipboardFiles, pastedImageName } from "./clipboard";

function file(name: string, type: string): File {
  return new File(["x"], name, { type });
}

describe("clipboardFiles", () => {
  it("keeps files already exposed by the clipboard", () => {
    const image = file("photo.png", "image/png");
    expect(clipboardFiles({ files: [image], items: [] })).toEqual([image]);
  });

  it("falls back to image items when the clipboard exposes no files", () => {
    const image = file("", "image/png");
    const item = { kind: "file", type: "image/png", getAsFile: () => image };
    expect(clipboardFiles({ files: [], items: [item] })).toEqual([image]);
  });

  it("prefers a typed image item when the clipboard file has no type", () => {
    const untyped = file("", "");
    const image = file("", "image/png");
    const item = { kind: "file", type: "image/png", getAsFile: () => image };
    expect(clipboardFiles({ files: [untyped], items: [item] })).toEqual([image]);
  });

  it("ignores text and non-image items", () => {
    const text = { kind: "string", type: "text/plain", getAsFile: () => null };
    const doc = {
      kind: "file",
      type: "application/pdf",
      getAsFile: () => file("a.pdf", "application/pdf"),
    };
    expect(clipboardFiles({ files: [], items: [text, doc] })).toEqual([]);
  });
});

describe("pastedImageName", () => {
  it("names an unnamed pasted image", () => {
    expect(pastedImageName(file("", "image/png"), 0)).toBe("pasted-image-1.png");
    expect(pastedImageName(file("", "image/jpeg"), 1)).toBe("pasted-image-2.jpg");
  });

  it("keeps the original name when there is one", () => {
    expect(pastedImageName(file("shot.png", "image/png"), 0)).toBe("shot.png");
  });
});
