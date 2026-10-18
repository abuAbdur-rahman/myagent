import { beforeEach, describe, expect, it, vi } from "vitest";

import { documentRead } from "./api";
import { listKnowledgeDocs } from "./db";
import { resolveImageSend, searchKnowledge } from "./knowledge";

vi.mock("./api", () => ({
  documentRead: vi.fn(),
}));

vi.mock("./db", () => ({
  listKnowledgeDocs: vi.fn(),
}));

const read = vi.mocked(documentRead);
const list = vi.mocked(listKnowledgeDocs);

function row(sha256: string, name: string) {
  return {
    id: `k-${sha256}`,
    project_id: "p1",
    chat_id: null,
    name,
    mime: "text/markdown",
    sha256,
    path: `documents/${sha256}.txt`,
    size: 30,
    created_at: 1,
  };
}

describe("resolveImageSend", () => {
  const images = [{ dataUrl: "data:image/jpeg;base64,AAA" }];

  it("keeps images for vision models", () => {
    const gated = resolveImageSend(true, images);
    expect(gated.dropped).toBe(false);
    expect(gated.kept).toHaveLength(1);
  });

  it("drops images for non-vision models", () => {
    const gated = resolveImageSend(false, images);
    expect(gated.dropped).toBe(true);
    expect(gated.kept).toHaveLength(0);
  });

  it("never drops when there are no images", () => {
    expect(resolveImageSend(false, []).dropped).toBe(false);
  });
});

describe("searchKnowledge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty for a blank query without hitting db", async () => {
    expect(await searchKnowledge("p1", "   ")).toBe("");
    expect(list).not.toHaveBeenCalled();
  });

  it("returns empty when the project has no docs", async () => {
    list.mockResolvedValue([]);
    expect(await searchKnowledge("p1", "async")).toBe("");
    expect(read).not.toHaveBeenCalled();
  });

  it("ranks excerpts and wraps them in source tags", async () => {
    list.mockResolvedValue([row("s1", "other.md"), row("s2", "async-guide.md")]);
    read.mockImplementation(async (sha: string) =>
      sha === "s1" ? "async runtimes power the app" : "unrelated body",
    );
    const block = await searchKnowledge("p1", "async");
    expect(block).toContain('<source name="async-guide.md">');
    expect(block).toContain("unrelated body");
    expect(read).toHaveBeenCalledWith("s2", "p1");
  });

  it("skips docs whose text cannot be read", async () => {
    list.mockResolvedValue([row("s1", "broken.md"), row("s2", "async-guide.md")]);
    read.mockImplementation(async (sha: string) => {
      if (sha === "s1") throw new Error("missing");
      return "async runtimes power the app";
    });
    const block = await searchKnowledge("p1", "async");
    expect(block).toContain("async-guide.md");
    expect(block).not.toContain("broken.md");
  });
});
