import { describe, expect, it } from "vitest";

import { filterMemories, memoryJson, memoryMatches } from "./memory-export";
import type { Memory, PendingMemory } from "./types";

const MEMORY: Memory = {
  id: "m1",
  scope: "global",
  project_id: null,
  kind: "preference",
  content: "Always answer with TypeScript examples.",
  source_conversation_id: "c1",
  created_at: Date.parse("2026-10-01T10:00:00Z"),
  updated_at: Date.parse("2026-10-01T10:00:00Z"),
};

const HAND_WRITTEN: Memory = {
  id: "m2",
  scope: "global",
  project_id: null,
  kind: "fact",
  content: "Lives in Berlin.",
  created_at: Date.parse("2026-09-01T10:00:00Z"),
  updated_at: Date.parse("2026-09-01T10:00:00Z"),
};

const PENDING: PendingMemory = {
  id: "p1",
  scope: "global",
  project_id: null,
  kind: "note",
  content: "Prefers short release notes.",
  conversation_id: "c1",
  created_at: Date.parse("2026-10-20T10:00:00Z"),
  trust: "trusted",
};

const title = (conversationId: string | null) =>
  conversationId === "c1" ? "Release planning" : null;

describe("memoryMatches", () => {
  it("matches on the text a person would search", () => {
    expect(memoryMatches(MEMORY, "typescript")).toBe(true);
    expect(memoryMatches(MEMORY, "berlin")).toBe(false);
  });

  it("matches the kind and the scope", () => {
    expect(memoryMatches(MEMORY, "preference")).toBe(true);
    expect(memoryMatches(MEMORY, "global")).toBe(true);
  });

  it("keeps everything for an empty query", () => {
    expect(memoryMatches(MEMORY, "   ")).toBe(true);
  });
});

describe("filterMemories", () => {
  it("drops what does not match", () => {
    expect(filterMemories([MEMORY, HAND_WRITTEN], "berlin").map((m) => m.id)).toEqual(["m2"]);
  });
});

describe("memoryJson", () => {
  const parsed = () =>
    JSON.parse(
      memoryJson([MEMORY, HAND_WRITTEN], [PENDING], title, new Date("2026-10-22T12:00:00Z")),
    ) as {
      exported_at: string;
      saved: Array<Record<string, string | null>>;
      pending: Array<Record<string, string | null>>;
    };

  it("names the chat a note came from", () => {
    expect(parsed().saved[0].source_chat).toBe("Release planning");
  });

  it("leaves the source empty for a note the user typed", () => {
    expect(parsed().saved[1].source_chat).toBeNull();
  });

  it("keeps queued notes in the file so an export is not a silent drop", () => {
    expect(parsed().pending).toHaveLength(1);
    expect(parsed().pending[0].queued).toBe("2026-10-20T10:00:00.000Z");
  });

  it("uses ISO times", () => {
    expect(parsed().saved[0].created).toBe("2026-10-01T10:00:00.000Z");
  });
});
