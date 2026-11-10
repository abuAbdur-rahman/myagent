import { describe, expect, it } from "vitest";

import { artifactVersions } from "./artifact-versions";
import type { Message } from "./types";

function message(
  id: string,
  parentId: string | null,
  createdAt: number,
  content: string,
  artifacts: string | null = null,
): Message {
  return {
    id,
    conversation_id: "chat-1",
    role: "assistant",
    content,
    artifacts,
    parent_id: parentId,
    created_at: createdAt,
  };
}

const page = (title: string) =>
  `\`\`\`html\n<!doctype html><html><head><title>${title}</title></head><body>${title}</body></html>\n\`\`\``;

describe("artifactVersions", () => {
  it("resolves the same fenced artifact across sibling regenerations", () => {
    const rows = [
      message("a1", "user-1", 2, page("First")),
      message("a2", "user-1", 3, page("Second")),
      message("other", "user-2", 4, page("Other branch")),
    ];

    const versions = artifactVersions("a2", { kind: "fence", index: 0 }, rows);
    expect(versions.map((version) => version.title)).toEqual(["First.html", "Second.html"]);
    expect(versions.map((version) => version.index)).toEqual([1, 2]);
    expect(versions.every((version) => version.total === 2)).toBe(true);
  });

  it("resolves declared artifacts by position and skips missing versions", () => {
    const first = JSON.stringify([
      { title: "Plan", lang: "md", code: "one" },
      { title: "Data", lang: "json", code: "{}" },
    ]);
    const second = JSON.stringify([{ title: "Plan", lang: "md", code: "two" }]);
    const rows = [
      message("a1", "user-1", 2, "", first),
      message("a2", "user-1", 3, "", second),
    ];

    expect(artifactVersions("a2", { kind: "tool", index: 0 }, rows)).toHaveLength(2);
    expect(artifactVersions("a1", { kind: "tool", index: 1 }, rows)).toHaveLength(1);
  });
});
