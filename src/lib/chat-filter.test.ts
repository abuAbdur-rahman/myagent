import { describe, expect, it } from "vitest";

import { emptyFilterText, filterChats, parseChatFilter } from "./chat-filter";
import type { Conversation } from "./types";

function chat(id: string, projectId: string | null, pinned = 0): Conversation {
  return {
    id,
    title: id,
    connection_id: null,
    project_id: projectId,
    pinned,
    compacted: 0,
    model: null,
    summary: null,
    summary_through: null,
    system_prompt: null,
    created_at: 0,
    updated_at: 0,
  };
}

const CHATS = [chat("a", null), chat("b", "p1"), chat("c", "p1", 1), chat("d", "p2")];

describe("parseChatFilter", () => {
  it("defaults to all", () => {
    expect(parseChatFilter(null)).toBe("all");
    expect(parseChatFilter("nonsense")).toBe("all");
  });

  it("reads a project filter back", () => {
    expect(parseChatFilter("project:p1")).toBe("project:p1");
    expect(parseChatFilter("pinned")).toBe("pinned");
  });
});

describe("filterChats", () => {
  it("keeps only pinned chats", () => {
    expect(filterChats(CHATS, "pinned").map((c) => c.id)).toEqual(["c"]);
  });

  it("keeps only one project's chats", () => {
    expect(filterChats(CHATS, "project:p1").map((c) => c.id)).toEqual(["b", "c"]);
  });

  it("keeps everything for all", () => {
    expect(filterChats(CHATS, "all")).toHaveLength(4);
  });

  it("returns nothing for a project with no chats", () => {
    expect(filterChats(CHATS, "project:p9")).toEqual([]);
  });
});

describe("emptyFilterText", () => {
  it("stays quiet when no filter is on", () => {
    expect(emptyFilterText("all", null)).toBeNull();
  });

  it("names what the filter was looking for", () => {
    expect(emptyFilterText("pinned", null)).toBe("No pinned chats.");
    expect(emptyFilterText("project:p1", "Agent")).toBe("No chats in Agent yet.");
    expect(emptyFilterText("project:p1", null)).toBe("No chats in this project yet.");
  });
});
