import { describe, expect, it } from "vitest";

import {
  hasUntrustedProvenance,
  projectScopedNotes,
  rollupReason,
  rollupTranscript,
  uniqueRollupNotes,
} from "./memory-rollup";
import type { Message } from "./types";

function message(
  id: string,
  role: Message["role"],
  content: string,
  toolLog: string | null = null,
): Message {
  return {
    id,
    conversation_id: "chat-1",
    role,
    content,
    tool_log: toolLog,
    created_at: Number(id.replace(/\D/g, "")) || 1,
  };
}

describe("rollupReason", () => {
  it("rolls project chats on close, explicit requests, and every tenth turn", () => {
    expect(
      rollupReason({ projectId: "p1", leaving: true, userTurns: 3, userText: "bye" }),
    ).toBe("close");
    expect(
      rollupReason({
        projectId: "p1",
        leaving: false,
        userTurns: 3,
        userText: "Remember that releases use NSIS",
      }),
    ).toBe("explicit");
    expect(
      rollupReason({ projectId: "p1", leaving: false, userTurns: 10, userText: "done" }),
    ).toBe("interval");
  });

  it("does not roll global chats, ordinary turns, questions, or negated requests", () => {
    expect(
      rollupReason({ projectId: null, leaving: true, userTurns: 10, userText: "remember this" }),
    ).toBeNull();
    expect(
      rollupReason({ projectId: "p1", leaving: false, userTurns: 9, userText: "continue" }),
    ).toBeNull();
    expect(
      rollupReason({ projectId: "p1", leaving: false, userTurns: 2, userText: "Remember this?" }),
    ).toBeNull();
    expect(
      rollupReason({
        projectId: "p1",
        leaving: false,
        userTurns: 2,
        userText: "Do not remember this",
      }),
    ).toBeNull();
  });
});

describe("rollupTranscript", () => {
  it("keeps complete recent user and assistant lines inside the cap", () => {
    const text = rollupTranscript(
      [
        message("m1", "system", "hidden"),
        message("m2", "user", "old ".repeat(20)),
        message("m3", "assistant", "lasting decision"),
      ],
      60,
    );
    expect(text).toBe("Assistant: lasting decision");
    expect(text).not.toContain("hidden");
  });
});

describe("hasUntrustedProvenance", () => {
  it("flags a transcript that used a tool with outside input", () => {
    const toolLog = JSON.stringify([
      { id: "t1", name: "web_fetch", summary: "read page", status: "ok", preview: null },
    ]);
    expect(hasUntrustedProvenance([message("m1", "assistant", "done", toolLog)])).toBe(true);
    expect(hasUntrustedProvenance([message("m2", "assistant", "done")])).toBe(false);
  });

  it("treats MCP tools as outside input", () => {
    const toolLog = JSON.stringify([
      { id: "t1", name: "mcp__docs__lookup", summary: "lookup", status: "ok", preview: null },
    ]);
    expect(hasUntrustedProvenance([message("m1", "assistant", "done", toolLog)])).toBe(true);
  });
});

describe("projectScopedNotes", () => {
  it("keeps project facts and drops notes about a person", () => {
    expect(
      projectScopedNotes([
        "Release builds use NSIS and run on Windows only",
        "The user prefers short answers",
        "The user's editor is VS Code",
        "I will keep the changelog short",
      ]),
    ).toEqual(["Release builds use NSIS and run on Windows only"]);
  });
});

describe("uniqueRollupNotes", () => {
  it("drops exact existing and repeated proposals", () => {
    expect(
      uniqueRollupNotes(
        ["Uses NSIS for releases", " uses  nsis for releases ", "Windows only"],
        ["Uses NSIS for releases"],
      ),
    ).toEqual(["Windows only"]);
  });
});
