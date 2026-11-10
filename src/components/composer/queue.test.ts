import { describe, expect, it } from "vitest";

import {
  enqueueMessage,
  moveQueuedMessage,
  moveQueuedMessageToFront,
  queuePreview,
  queuedFor,
  removeQueuedMessage,
  type QueuedMessage,
} from "./queue";

function item(id: string, conversationId = "c1", text = id): QueuedMessage<string> {
  return { id, conversationId, text, attachments: [] };
}

describe("queue helpers", () => {
  it("appends and removes", () => {
    const list = enqueueMessage(enqueueMessage([], item("a")), item("b"));
    expect(list.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(removeQueuedMessage(list, "a").map((entry) => entry.id)).toEqual(["b"]);
  });

  it("reorders and clamps the target index", () => {
    const list = [item("a"), item("b"), item("c")];
    expect(moveQueuedMessage(list, "c", 0).map((entry) => entry.id)).toEqual(["c", "a", "b"]);
    expect(moveQueuedMessage(list, "a", 99).map((entry) => entry.id)).toEqual(["b", "c", "a"]);
    expect(moveQueuedMessage(list, "missing", 0)).toBe(list);
    expect(moveQueuedMessage(list, "b", 1)).toBe(list);
  });

  it("moves an item to the front", () => {
    const list = [item("a"), item("b"), item("c")];
    expect(moveQueuedMessageToFront(list, "c").map((entry) => entry.id)).toEqual(["c", "a", "b"]);
  });

  it("keeps queue order when filtering by conversation", () => {
    const list = [item("a", "c1"), item("b", "c2"), item("c", "c1")];
    expect(queuedFor(list, "c1").map((entry) => entry.id)).toEqual(["a", "c"]);
    expect(queuedFor(list, "c3")).toEqual([]);
  });
});

describe("queuePreview", () => {
  it("flattens whitespace and trims", () => {
    expect(queuePreview("  one\n\n  two  ")).toBe("one two");
  });

  it("truncates with an ellipsis", () => {
    expect(queuePreview("abcdef", 4)).toBe("abcd…");
  });
});
