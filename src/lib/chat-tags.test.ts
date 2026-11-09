import { describe, expect, it } from "vitest";

import { filterChatsByTag } from "./chat-tags";
import type { Conversation } from "./types";

function chat(id: string, extra: Partial<Conversation> = {}): Conversation {
  return {
    id,
    title: id,
    connection_id: "conn",
    project_id: null,
    pinned: 0,
    compacted: 0,
    model: "test/model",
    summary: null,
    summary_through: null,
    created_at: 1,
    updated_at: 1,
    ...extra,
  };
}

describe("filterChatsByTag", () => {
  const chats = [chat("a"), chat("b"), chat("c")];
  const tags = new Map<string, string[]>([
    ["a", ["release", "work"]],
    ["b", ["work"]],
  ]);

  it("returns every non-temporary chat without a tag filter", () => {
    const withTemporary = [...chats, chat("temp", { temporary: 1 })];
    expect(filterChatsByTag(withTemporary, null, tags).map((item) => item.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("returns only chats carrying the filtered tag", () => {
    expect(filterChatsByTag(chats, "release", tags).map((item) => item.id)).toEqual(["a"]);
    expect(filterChatsByTag(chats, "work", tags).map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("returns no chats for an unused tag", () => {
    expect(filterChatsByTag(chats, "missing", tags)).toEqual([]);
  });

  it("never lists a temporary chat even when it carries the tag", () => {
    const temporary = chat("temp", { temporary: 1 });
    const withTemporary = [...chats, temporary];
    expect(
      filterChatsByTag(withTemporary, "work", new Map([["temp", ["work"]]])).map(
        (item) => item.id,
      ),
    ).toEqual([]);
  });
});
