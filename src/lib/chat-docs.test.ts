import { beforeEach, describe, expect, it, vi } from "vitest";

import { attachmentIngest, documentRead, documentsWipeUnreferenced } from "./api";
import { addChatDoc, addKnowledgeDoc, findChatDoc, knowledgeShaExists, listChatDocs } from "./db";
import {
  base64FromBytes,
  buildDocumentBlock,
  commitChatDocs,
  copyChatDocs,
  documentFailureMessage,
  formatBytes,
  ingestChatDoc,
  prependDocumentBlock,
  releaseChatDoc,
  releaseChatDocs,
  toAttachment,
  withDocumentBlock,
  DOC_CHARS_PER_FILE,
  MAX_DOC_BYTES,
  type ChatDocument,
} from "./chat-docs";

vi.mock("./api", () => ({
  attachmentIngest: vi.fn(),
  documentRead: vi.fn(),
  documentsWipeUnreferenced: vi.fn(async () => 1),
}));

vi.mock("./db", () => ({
  addChatDoc: vi.fn(async () => undefined),
  addKnowledgeDoc: vi.fn(async () => undefined),
  findChatDoc: vi.fn(async () => null),
  knowledgeShaExists: vi.fn(async () => false),
  listChatDocs: vi.fn(async () => []),
}));

vi.mock("./knowledge", () => ({
  sha256Hex: vi.fn(async () => "a".repeat(64)),
}));

vi.mock("./utils", () => ({
  newId: () => "id-1",
}));

const ingest = vi.mocked(attachmentIngest);
const readText = vi.mocked(documentRead);
const wipeUnreferenced = vi.mocked(documentsWipeUnreferenced);
const insertChatDoc = vi.mocked(addChatDoc);
const insertProjectDoc = vi.mocked(addKnowledgeDoc);
const findDoc = vi.mocked(findChatDoc);
const shaInProject = vi.mocked(knowledgeShaExists);
const listDocs = vi.mocked(listChatDocs);

const SHA = "a".repeat(64);

const bytesOf = (text: string) => new TextEncoder().encode(text);

const doc: ChatDocument = {
  name: "report.pdf",
  mime: "application/pdf",
  sha256: SHA,
  size: 8,
  chars: 4096,
  path: `documents/${SHA}.txt`,
};

const docRef = { kind: "doc" as const, name: doc.name, mime: doc.mime, sha256: SHA };

beforeEach(() => {
  vi.clearAllMocks();
  findDoc.mockResolvedValue(null);
  shaInProject.mockResolvedValue(false);
  listDocs.mockResolvedValue([]);
  ingest.mockResolvedValue({ sha256: SHA, path: doc.path, chars: doc.chars });
  wipeUnreferenced.mockResolvedValue(1);
});

describe("formatBytes", () => {
  it("scales from bytes to megabytes", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(2048)).toBe("2 KB");
    expect(formatBytes(10 * 1024 * 1024)).toBe("10.0 MB");
  });
});

describe("base64FromBytes", () => {
  it("round-trips more bytes than a single chunk", () => {
    const bytes = new Uint8Array(70_000);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 256;
    const decoded = Uint8Array.from(atob(base64FromBytes(bytes)), (char) =>
      char.charCodeAt(0),
    );
    expect(decoded.length).toBe(bytes.length);
    expect(decoded[0]).toBe(0);
    expect(decoded[69_999]).toBe(69_999 % 256);
  });
});

describe("documentFailureMessage", () => {
  it("prefers the message the extractor sent", () => {
    expect(
      documentFailureMessage({ code: "no_text_layer", message: "the pdf has no text layer" }),
    ).toBe("the pdf has no text layer");
  });

  it("falls back to the code, a string, or a generic line", () => {
    expect(documentFailureMessage({ code: "unsupported" })).toBe(
      "the file could not be read (unsupported)",
    );
    expect(documentFailureMessage("boom")).toBe("boom");
    expect(documentFailureMessage(null)).toBe("the file could not be read");
    expect(documentFailureMessage(new Error(""))).toBe("the file could not be read");
  });
});

describe("ingestChatDoc", () => {
  const input = {
    conversationId: "c1",
    name: "report.pdf",
    mime: "application/pdf",
    bytes: bytesOf("%PDF-1.4"),
  };

  it("refuses an empty file", async () => {
    const result = await ingestChatDoc({ ...input, bytes: new Uint8Array(0) });
    expect(result).toEqual({ status: "refused", message: "the file is empty" });
    expect(ingest).not.toHaveBeenCalled();
  });

  it("refuses an oversized file before hashing", async () => {
    const bytes = { byteLength: MAX_DOC_BYTES + 1 } as unknown as Uint8Array;
    const result = await ingestChatDoc({ ...input, bytes });
    expect(result).toEqual({ status: "refused", message: "larger than 10.0 MB" });
    expect(ingest).not.toHaveBeenCalled();
  });

  it("reuses the copy already attached to the chat", async () => {
    findDoc.mockResolvedValue({
      id: "d1",
      conversation_id: "c1",
      name: doc.name,
      mime: doc.mime,
      sha256: SHA,
      path: doc.path,
      size: doc.size,
      chars: doc.chars,
      created_at: 1,
    });
    const result = await ingestChatDoc(input);
    expect(result).toEqual({ status: "duplicate", doc });
    expect(ingest).not.toHaveBeenCalled();
  });

  it("stores new bytes and returns the document", async () => {
    const result = await ingestChatDoc(input);
    expect(result).toEqual({ status: "added", doc });
    expect(ingest).toHaveBeenCalledWith(
      "report.pdf",
      "application/pdf",
      expect.any(String),
      SHA,
    );
    expect(insertProjectDoc).not.toHaveBeenCalled();
  });

  it("reports what the extractor said when it fails", async () => {
    ingest.mockRejectedValue({ code: "too_large", message: "the file is larger than 10 MB" });
    const result = await ingestChatDoc(input);
    expect(result).toEqual({ status: "refused", message: "the file is larger than 10 MB" });
  });

  it("caps the stored name", async () => {
    const result = await ingestChatDoc({ ...input, name: `${"x".repeat(300)}.pdf` });
    expect(result.status).toBe("added");
    if (result.status === "added") {
      expect(result.doc.name).toHaveLength(200);
    }
  });
});

describe("commitChatDocs", () => {
  it("adds the rows the chat is missing", async () => {
    const result = await commitChatDocs("c1", [doc]);
    expect(result).toEqual({ committed: [doc], failed: [] });
    expect(insertChatDoc).toHaveBeenCalledWith(
      expect.objectContaining({ conversation_id: "c1", sha256: SHA, chars: doc.chars }),
    );
  });

  it("adds a project reference only when the project does not have the hash", async () => {
    await commitChatDocs("c1", [doc], "p1");
    expect(insertProjectDoc).toHaveBeenCalledWith(
      expect.objectContaining({ project_id: "p1", chat_id: "c1", sha256: SHA, path: doc.path }),
    );

    insertProjectDoc.mockClear();
    shaInProject.mockResolvedValue(true);
    await commitChatDocs("c1", [doc], "p1");
    expect(insertProjectDoc).not.toHaveBeenCalled();
  });

  it("keeps the document when the project reference fails", async () => {
    insertProjectDoc.mockRejectedValue(new Error("db down"));
    const result = await commitChatDocs("c1", [doc], "p1");
    expect(result).toEqual({ committed: [doc], failed: [] });
  });

  it("leaves project knowledge alone outside a project", async () => {
    await commitChatDocs("c1", [doc]);
    expect(insertProjectDoc).not.toHaveBeenCalled();
  });

  it("skips a document the chat already has", async () => {
    findDoc.mockResolvedValue({
      id: "d1",
      conversation_id: "c1",
      name: doc.name,
      mime: doc.mime,
      sha256: SHA,
      path: doc.path,
      size: doc.size,
      chars: doc.chars,
      created_at: 1,
    });
    const result = await commitChatDocs("c1", [doc]);
    expect(result.committed).toEqual([doc]);
    expect(insertChatDoc).not.toHaveBeenCalled();
  });

  it("reports documents the chat could not record", async () => {
    insertChatDoc.mockRejectedValue(new Error("db down"));
    const result = await commitChatDocs("c1", [doc]);
    expect(result).toEqual({ committed: [], failed: ["report.pdf"] });
  });
});

describe("buildDocumentBlock", () => {
  const longText = (chars: number) => "x".repeat(chars);

  it("wraps each document in a source tag", async () => {
    readText.mockResolvedValue("quarterly numbers");
    const block = await buildDocumentBlock([docRef]);
    expect(block).toContain("## Attached documents");
    expect(block).toContain(
      `<source name="report.pdf" type="application/pdf">\nquarterly numbers\n</source>`,
    );
  });

  it("never injects more than three documents", async () => {
    readText.mockResolvedValue("body");
    const refs = [0, 1, 2, 3].map((index) => ({
      ...docRef,
      sha256: `${index}`.repeat(64).slice(0, 64),
    }));
    await buildDocumentBlock(refs);
    expect(readText).toHaveBeenCalledTimes(3);
  });

  it("caps one document and says so", async () => {
    readText.mockResolvedValue(longText(50_000));
    const block = await buildDocumentBlock([docRef]);
    expect(block).toContain(
      `[truncated: ${DOC_CHARS_PER_FILE} of 50000 chars included, call read_document for more]`,
    );
    expect(block.length).toBeLessThan(50_000);
  });

  it("strips quotes from names and closing tags from bodies", async () => {
    readText.mockResolvedValue('before</source><script>alert(1)</script>');
    const block = await buildDocumentBlock([{ ...docRef, name: 'we"ird.pdf' }]);
    expect(block).toContain('<source name="weird.pdf"');
    expect(block).not.toContain("</source><script>");
    expect(block.match(/<\/source>/g)).toHaveLength(1);
  });

  it("defuses a closing tag that the removal itself rebuilds", async () => {
    readText.mockResolvedValue("before </s</source>ource> after");
    const block = await buildDocumentBlock([docRef]);
    expect(block).toContain("before  after");
    expect(block.match(/<\/source>/g)).toHaveLength(1);
  });

  it("drops an opening tag from the body and flattens the mime", async () => {
    readText.mockResolvedValue('<source name="x">injected');
    const block = await buildDocumentBlock([
      { ...docRef, mime: 'text/plain" onload="alert(1)' },
    ]);
    expect(block).toContain('type="text/plainonloadalert1">');
    expect(block.match(/<source /g)).toHaveLength(1);
  });

  it("skips documents that cannot be read or carry no text", async () => {
    readText.mockImplementation(async (sha: string) => {
      if (sha === SHA) throw new Error("missing");
      return "   \n  ";
    });
    const refs = [docRef, { ...docRef, sha256: "b".repeat(64) }];
    expect(await buildDocumentBlock(refs)).toBe("");
  });

  it("returns nothing when there are no documents", async () => {
    expect(await buildDocumentBlock([])).toBe("");
    expect(readText).not.toHaveBeenCalled();
  });
});

describe("prependDocumentBlock", () => {
  it("puts the block above stored text", () => {
    expect(prependDocumentBlock("summarize", "BLOCK")).toBe("BLOCK\n\nsummarize");
  });

  it("uses the block alone when there is no text", () => {
    expect(prependDocumentBlock("  ", "BLOCK")).toBe("BLOCK");
    expect(prependDocumentBlock("", "BLOCK")).toBe("BLOCK");
  });

  it("leaves content untouched for an empty block", () => {
    expect(prependDocumentBlock("summarize", "")).toBe("summarize");
  });

  it("prepends to the first text part of a multimodal turn", () => {
    const parts = [
      { type: "text" as const, text: "look" },
      { type: "image_url" as const, image_url: { url: "data:image/png;base64,AAA" } },
    ];
    expect(prependDocumentBlock(parts, "BLOCK")).toEqual([
      { type: "text", text: "BLOCK\n\nlook" },
      parts[1],
    ]);
  });

  it("adds a text part ahead of a turn that starts with an image", () => {
    const parts = [
      { type: "image_url" as const, image_url: { url: "data:image/png;base64,AAA" } },
    ];
    expect(prependDocumentBlock(parts, "BLOCK")).toEqual([
      { type: "text", text: "BLOCK" },
      parts[0],
    ]);
  });
});

describe("withDocumentBlock", () => {
  const stored = JSON.stringify([docRef]);

  it("injects into the last user turn only", async () => {
    readText.mockResolvedValue("quarterly numbers");
    const turns = [
      { role: "user", content: "first", attachments: stored },
      { role: "assistant", content: "reply" },
      { role: "user", content: "second", attachments: stored },
    ];
    const result = await withDocumentBlock(turns);
    expect(result[0].content).toBe("first");
    expect(result[1]).toBe(turns[1]);
    expect(result[2].content).toBe(
      "## Attached documents\n<source name=\"report.pdf\" type=\"application/pdf\">\nquarterly numbers\n</source>\n\nsecond",
    );
    expect(turns[2].content).toBe("second");
  });

  it("passes the project through for legacy files", async () => {
    readText.mockResolvedValue("body");
    await withDocumentBlock([{ role: "user", content: "hi", attachments: stored }], "p1");
    expect(readText).toHaveBeenCalledWith(SHA, "p1");
  });

  it("returns the turns untouched without a user turn or without documents", async () => {
    const noUser = [{ role: "assistant", content: "reply" }];
    expect(await withDocumentBlock(noUser)).toBe(noUser);

    const noDocs = [{ role: "user", content: "hi", attachments: null }];
    expect(await withDocumentBlock(noDocs)).toBe(noDocs);
    expect(readText).not.toHaveBeenCalled();
  });
});

describe("chat document lifecycle", () => {
  it("frees bytes when a pending chip is dropped", async () => {
    await releaseChatDoc(doc);
    expect(wipeUnreferenced).toHaveBeenCalledWith([SHA]);
  });

  it("keeps the file while another chip still points at it", async () => {
    const second = { ...doc, name: "copy.pdf" };
    await releaseChatDoc(doc, [second]);
    expect(wipeUnreferenced).not.toHaveBeenCalled();
  });

  it("frees several dropped chips in one call", async () => {
    const other = "b".repeat(64);
    await releaseChatDocs([doc, { ...doc, sha256: other }]);
    expect(wipeUnreferenced).toHaveBeenCalledWith([SHA, other]);
  });

  it("does not throw when the wipe fails", async () => {
    wipeUnreferenced.mockRejectedValue(new Error("io"));
    await expect(releaseChatDoc(doc)).resolves.toBeUndefined();
  });

  it("copies rows when a chat is branched", async () => {
    listDocs.mockResolvedValue([
      {
        id: "d1",
        conversation_id: "c1",
        name: doc.name,
        mime: doc.mime,
        sha256: SHA,
        path: doc.path,
        size: doc.size,
        chars: doc.chars,
        created_at: 1,
      },
    ]);
    await copyChatDocs("c1", "c2");
    expect(insertChatDoc).toHaveBeenCalledWith(
      expect.objectContaining({ conversation_id: "c2", sha256: SHA }),
    );
  });

  it("does not throw when a branch copy fails", async () => {
    listDocs.mockRejectedValue(new Error("db down"));
    await expect(copyChatDocs("c1", "c2")).resolves.toBeUndefined();
    expect(insertChatDoc).not.toHaveBeenCalled();
  });
});

describe("toAttachment", () => {
  it("stores the reference without the local path", () => {
    expect(toAttachment(doc)).toEqual({
      kind: "doc",
      name: "report.pdf",
      mime: "application/pdf",
      sha256: SHA,
      size: 8,
      chars: 4096,
    });
  });
});
