import { describe, expect, it } from "vitest";

import { arrangeChats, groupChats } from "./grouping";
import type { Conversation } from "./types";

const NOW = new Date("2026-03-10T12:00:00").getTime();
const DAY = 86_400_000;

function chat(id: string, updatedAt: number, pinned = 0): Conversation {
  return {
    id,
    title: id,
    connection_id: null,
    project_id: null,
    pinned,
    compacted: 0,
    model: null,
    summary: null,
    summary_through: null,
    system_prompt: null,
    created_at: updatedAt,
    updated_at: updatedAt,
  };
}

const OLD = chat("old", NOW - 30 * DAY);
const LAST_WEEK = chat("last-week", NOW - 4 * DAY);
const YESTERDAY = chat("yesterday", NOW - DAY);
const TODAY = chat("today", NOW);
const PINNED = chat("pinned", NOW - 60 * DAY, 1);

describe("groupChats", () => {
  it("buckets by age and keeps pinned first", () => {
    const names = groupChats([OLD, TODAY, PINNED, YESTERDAY, LAST_WEEK], NOW).map((g) => g.name);
    expect(names).toEqual(["Pinned", "Today", "Yesterday", "Previous 7 days", "Older"]);
  });

  it("drops empty buckets", () => {
    expect(groupChats([TODAY], NOW).map((g) => g.name)).toEqual(["Today"]);
  });
});

describe("arrangeChats", () => {
  it("uses the date groups when the preference is on", () => {
    const names = arrangeChats([TODAY, OLD], true, NOW).map((g) => g.name);
    expect(names).toEqual(["Today", "Older"]);
  });

  it("collapses the dates into one list when the preference is off", () => {
    const groups = arrangeChats([OLD, LAST_WEEK, YESTERDAY, TODAY], false, NOW);
    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("Chats");
    expect(groups[0].items.map((c) => c.id)).toEqual(["today", "yesterday", "last-week", "old"]);
  });

  it("keeps pinned chats above the flat list", () => {
    const groups = arrangeChats([TODAY, PINNED], false, NOW);
    expect(groups.map((g) => g.name)).toEqual(["Pinned", "Chats"]);
    expect(groups[1].items.map((c) => c.id)).toEqual(["today"]);
  });

  it("returns nothing for an empty list", () => {
    expect(arrangeChats([], false, NOW)).toEqual([]);
  });
});
