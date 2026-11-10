import { describe, expect, it } from "vitest";

import type { Message } from "./types";
import {
  deepestLeaf,
  descendantsOf,
  latestLeaf,
  messagePath,
  orderMessages,
  siblingVersions,
  versionMap,
} from "./message-tree";

function msg(id: string, parentId: string | null, at: number): Message {
  return {
    id,
    conversation_id: "c1",
    role: "user",
    content: id,
    created_at: at,
    parent_id: parentId,
  };
}

function index(rows: Message[]): Map<string, Message> {
  return new Map(rows.map((row) => [row.id, row]));
}

describe("messagePath", () => {
  it("returns root to leaf", () => {
    const rows = [msg("a", null, 1), msg("b", "a", 2), msg("c", "b", 3), msg("d", "b", 4)];
    const byId = index(rows);
    expect(messagePath("c", byId).map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(messagePath("d", byId).map((row) => row.id)).toEqual(["a", "b", "d"]);
  });

  it("returns an empty path for a null or unknown leaf", () => {
    expect(messagePath(null, index([msg("a", null, 1)]))).toEqual([]);
    expect(messagePath("missing", index([msg("a", null, 1)]))).toEqual([]);
  });

  it("stops on a cycle", () => {
    const rows = [msg("a", "b", 1), msg("b", "a", 2)];
    expect(messagePath("a", index(rows)).map((row) => row.id)).toEqual(["b", "a"]);
  });
});

describe("latestLeaf", () => {
  it("picks the newest message, breaking ties by id", () => {
    expect(latestLeaf([])).toBeNull();
    expect(latestLeaf([msg("b", null, 2), msg("a", null, 2), msg("c", null, 1)])).toBe("b");
  });
});

describe("siblingVersions", () => {
  it("groups messages that share a parent, in order", () => {
    const rows = [msg("u1", null, 1), msg("a1", "u1", 3), msg("a2", "u1", 2), msg("u2", null, 4)];
    expect(siblingVersions(rows[1], rows).map((row) => row.id)).toEqual(["a2", "a1"]);
    expect(siblingVersions(rows[0], rows).map((row) => row.id)).toEqual(["u1", "u2"]);
  });
});

describe("deepestLeaf", () => {
  it("follows the newest child to the end", () => {
    const rows = [msg("u", null, 1), msg("a1", "u", 2), msg("a2", "u", 3), msg("b1", "a2", 4)];
    expect(deepestLeaf("u", rows)).toBe("b1");
    expect(deepestLeaf("a1", rows)).toBe("a1");
  });
});

describe("descendantsOf", () => {
  it("collects the whole subtree and keeps siblings out", () => {
    const rows = [msg("u", null, 1), msg("a1", "u", 2), msg("a2", "u", 3), msg("b1", "a2", 4)];
    const found = descendantsOf("a2", rows);
    expect([...found].sort()).toEqual(["b1"]);
    expect(descendantsOf("u", rows).size).toBe(3);
  });
});

describe("versionMap", () => {
  it("labels only messages with more than one version", () => {
    const rows = [msg("u", null, 1), msg("a1", "u", 2), msg("a2", "u", 3), msg("b1", "a2", 4)];
    const path = messagePath("b1", index(rows));
    const map = versionMap(path, rows);
    expect(map.a1).toBeUndefined();
    expect(map.a2).toEqual({ index: 2, total: 2 });
  });
});

describe("orderMessages", () => {
  it("orders by time and falls back to id", () => {
    expect(orderMessages(msg("a", null, 2), msg("b", null, 2))).toBeLessThan(0);
    expect(orderMessages(msg("a", null, 1), msg("b", null, 2))).toBeLessThan(0);
  });
});
