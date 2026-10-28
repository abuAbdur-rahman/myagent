// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { clipboardFiles, pastedImageName } from "./clipboard";

function file(name: string, type: string): File {
  return new File(["x"], name, { type });
}

describe("clipboardFiles", () => {
  it("keeps files already exposed by the clipboard", async () => {
    const image = file("photo.png", "image/png");
    expect(await clipboardFiles({ files: [image], items: [] })).toEqual([image]);
  });

  it("falls back to image items when the clipboard exposes no files", async () => {
    const image = file("", "image/png");
    const item = { kind: "file", type: "image/png", getAsFile: () => image };
    expect(await clipboardFiles({ files: [], items: [item] })).toEqual([image]);
  });

  it("sniffs an image item with no MIME type", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const image = new File([bytes], "", { type: "" });
    const item = { kind: "file", type: "", getAsFile: () => image };
    const [typed] = await clipboardFiles({ files: [], items: [item] });
    expect(typed.type).toBe("image/png");
  });

  it("prefers a typed image item when the clipboard file has no type", async () => {
    const untyped = file("", "");
    const image = file("", "image/png");
    const item = { kind: "file", type: "image/png", getAsFile: () => image };
    expect(await clipboardFiles({ files: [untyped], items: [item] })).toEqual([image]);
  });

  it("keeps a document and adds an image item", async () => {
    const doc = file("a.pdf", "application/pdf");
    const image = file("", "image/png");
    const item = { kind: "file", type: "image/png", getAsFile: () => image };
    expect(await clipboardFiles({ files: [doc], items: [item] })).toEqual([doc, image]);
  });

  it("ignores text and non-image items", async () => {
    const text = { kind: "string", type: "text/plain", getAsFile: () => null };
    const doc = {
      kind: "file",
      type: "application/pdf",
      getAsFile: () => file("a.pdf", "application/pdf"),
    };
    expect(await clipboardFiles({ files: [], items: [text, doc] })).toEqual([]);
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
