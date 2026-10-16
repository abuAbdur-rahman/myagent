import { beforeEach, describe, expect, it, vi } from "vitest";

import { knowledgeSidecarRead, knowledgeSidecarWrite } from "./api";
import { addKnowledgeDoc, knowledgeShaExists, listKnowledgeDocs } from "./db";
import { ingestDoc, buildAttachmentSend, resolveImageSend, searchKnowledge } from "./knowledge";

vi.mock("./api", () => ({
  knowledgeSidecarWrite: vi.fn(),
  knowledgeSidecarRead: vi.fn(),
}));

vi.mock("./db", () => ({
  addKnowledgeDoc: vi.fn(),
  knowledgeShaExists: vi.fn(),
  listKnowledgeDocs: vi.fn(),
}));

vi.mock("./utils", () => ({
  newId: () => "id-1",
}));

const write = vi.mocked(knowledgeSidecarWrite);
const read = vi.mocked(knowledgeSidecarRead);
const shaExists = vi.mocked(knowledgeShaExists);
const list = vi.mocked(listKnowledgeDocs);
const add = vi.mocked(addKnowledgeDoc);

const bytesOf = (text: string) => new TextEncoder().encode(text);

describe("ingestDoc", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects binary types without touching sidecar or db", async () => {
    const result = await ingestDoc({
      projectId: "p1",
      name: "doc.pdf",
      mime: "application/pdf",
      bytes: bytesOf("%PDF"),
    });
    expect(result).toEqual({ status: "unsupported" });
    expect(write).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it("skips bytes already ingested", async () => {
    shaExists.mockResolvedValue(true);
    const result = await ingestDoc({
      projectId: "p1",
      name: "notes.md",
      mime: "text/markdown",
      bytes: bytesOf("hello"),
    });
    expect(result).toEqual({ status: "duplicate" });
    expect(write).not.toHaveBeenCalled();
  });

  it("writes sidecar then row for new text", async () => {
    shaExists.mockResolvedValue(false);
    write.mockResolvedValue("knowledge/p1/sha.txt");
    const result = await ingestDoc({
      projectId: "p1",
      chatId: null,
      name: "notes.md",
      mime: "text/markdown",
      bytes: bytesOf("hello"),
    });
    expect(result).toEqual({ status: "added", id: "id-1" });
    expect(write).toHaveBeenCalledOnce();
    expect(add).toHaveBeenCalledWith(
      expect.objectContaining({ project_id: "p1", name: "notes.md", size: 5 }),
    );
  });
});

describe("buildAttachmentSend", () => {
  const chips = [
    { name: "a.md", excerpt: "alpha" },
    { name: "b.md", excerpt: "beta" },
  ];

  it("falls back to chip names when text is empty", () => {
    const send = buildAttachmentSend("  ", chips);
    expect(send.outgoing).toBe("a.md, b.md");
    expect(send.block).toContain("<source name=a.md>alpha</source>");
  });

  it("keeps user text and appends chip excerpts", () => {
    const send = buildAttachmentSend("summarize", chips);
    expect(send.outgoing).toBe("summarize");
    expect(send.block).toContain("beta");
  });

  it("returns an empty block with no chips", () => {
    expect(buildAttachmentSend("hi", []).block).toBe("");
  });
});

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

  it("ranks excerpts and wraps them in source tags", async () => {
    list.mockResolvedValue([
      {
        id: "k1",
        project_id: "p1",
        chat_id: null,
        name: "other.md",
        mime: "text/markdown",
        sha256: "s1",
        path: "knowledge/p1/s1.txt",
        size: 30,
        created_at: 1,
      },
      {
        id: "k2",
        project_id: "p1",
        chat_id: null,
        name: "async-guide.md",
        mime: "text/markdown",
        sha256: "s2",
        path: "knowledge/p1/s2.txt",
        size: 20,
        created_at: 2,
      },
    ]);
    read.mockImplementation(async (_project: string, sha: string) =>
      sha === "s1" ? "async runtimes power the app" : "unrelated body",
    );
    const block = await searchKnowledge("p1", "async");
    expect(block).toContain("<source name=async-guide.md>");
    expect(block).toContain("unrelated body");
  });
});
