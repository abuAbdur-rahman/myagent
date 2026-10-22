import { describe, expect, it } from "vitest";

import {
  sessionOutputs,
  sessionUsage,
  stepLabel,
  stepProgress,
} from "./session";
import type { Message, Todo } from "./types";

let seq = 0;

function message(patch: Partial<Message> = {}): Message {
  seq += 1;
  return {
    id: `m${seq}`,
    conversation_id: "c1",
    role: "assistant",
    content: "",
    reasoning: null,
    thinking_ms: null,
    prompt_tokens: null,
    completion_tokens: null,
    total_tokens: null,
    finish_reason: null,
    tool_log: null,
    artifacts: null,
    attachments: null,
    model: null,
    created_at: seq,
    ...patch,
  };
}

const DOC = {
  kind: "doc" as const,
  name: "report.pdf",
  mime: "application/pdf",
  sha256: "a".repeat(64),
  size: 100,
  chars: 40,
};

const IMAGE = { kind: "image" as const, dataUrl: "data:image/png;base64,AAA" };

function toolLog(entries: unknown[]): string {
  return JSON.stringify(entries);
}

function todo(status: Todo["status"], text = "task"): Todo {
  seq += 1;
  return {
    id: `t${seq}`,
    chat_id: "c1",
    text,
    status,
    position: seq,
    created_at: 0,
    updated_at: 0,
  };
}

describe("sessionOutputs", () => {
  it("puts the newest artifact first", () => {
    const older = JSON.stringify([{ title: "first", lang: "html", code: "<p>a</p>" }]);
    const newer = JSON.stringify([{ title: "second", lang: "md", code: "# b" }]);
    const outputs = sessionOutputs([
      message({ artifacts: older }),
      message({ artifacts: newer }),
    ]);
    expect(outputs.map((o) => o.title)).toEqual(["second", "first"]);
  });

  it("dedupes on title and language", () => {
    const same = JSON.stringify([{ title: "report", lang: "html", code: "<p>a</p>" }]);
    const outputs = sessionOutputs([message({ artifacts: same }), message({ artifacts: same })]);
    expect(outputs).toHaveLength(1);
  });

  it("keeps the same title with a different language", () => {
    const html = JSON.stringify([{ title: "report", lang: "html", code: "<p>a</p>" }]);
    const md = JSON.stringify([{ title: "report", lang: "md", code: "# a" }]);
    expect(sessionOutputs([message({ artifacts: html }), message({ artifacts: md })])).toHaveLength(
      2,
    );
  });

  it("adds written files as rows with their extension", () => {
    const log = toolLog([
      {
        id: "1",
        name: "sandbox_write",
        summary: "Write: src/app.ts",
        status: "ok",
        preview: null,
        files: ["src/app.ts"],
      },
    ]);
    const outputs = sessionOutputs([message({ tool_log: log })]);
    expect(outputs).toEqual([
      expect.objectContaining({ title: "app.ts", lang: "ts", kind: "file" }),
    ]);
  });

  it("shows one row when the same file is written twice", () => {
    const entry = {
      id: "1",
      name: "sandbox_edit",
      summary: "Edit: src/app.ts",
      status: "ok",
      preview: null,
      files: ["src/app.ts"],
    };
    const outputs = sessionOutputs([message({ tool_log: toolLog([entry, entry]) })]);
    expect(outputs).toHaveLength(1);
  });

  it("reads nothing from an empty transcript", () => {
    expect(sessionOutputs([])).toEqual([]);
  });
});

describe("sessionUsage", () => {
  it("counts uploads, images and tools", () => {
    const usage = sessionUsage([
      message({
        role: "user",
        attachments: JSON.stringify([DOC, IMAGE]),
      }),
      message({
        tool_log: toolLog([
          { id: "1", name: "web_search", summary: "Search", status: "ok", preview: null, domains: ["docs.rs"] },
          { id: "2", name: "web_search", summary: "Search", status: "ok", preview: null, domains: ["example.com"] },
          { id: "3", name: "read_file", summary: "Read", status: "ok", preview: null },
        ]),
      }),
    ]);
    expect(usage.docs.map((d) => d.name)).toEqual(["report.pdf"]);
    expect(usage.images).toBe(1);
    expect(usage.tools).toEqual([
      { name: "web_search", count: 2 },
      { name: "read_file", count: 1 },
    ]);
    expect(usage.domains).toEqual(["docs.rs", "example.com"]);
  });

  it("does not repeat a domain or a file", () => {
    const entry = {
      id: "1",
      name: "web_search",
      summary: "Search",
      status: "ok",
      preview: null,
      domains: ["docs.rs"],
      files: ["src/a.ts"],
    };
    const usage = sessionUsage([message({ tool_log: toolLog([entry, entry]) })]);
    expect(usage.domains).toEqual(["docs.rs"]);
    expect(usage.files).toEqual(["src/a.ts"]);
  });

  it("starts empty for a chat with no messages", () => {
    expect(sessionUsage([])).toEqual({
      docs: [],
      images: 0,
      tools: [],
      domains: [],
      files: [],
    });
  });
});

describe("stepProgress", () => {
  it("reads the current step from the in-progress todo", () => {
    const todos = [
      todo("completed"),
      todo("completed"),
      todo("in_progress"),
      todo("pending"),
      todo("pending"),
    ];
    expect(stepProgress(todos)).toEqual({ done: 2, total: 5, current: 3 });
    expect(stepLabel(todos)).toBe("Step 3 of 5");
  });

  it("falls back to the next open step", () => {
    const todos = [todo("completed"), todo("pending")];
    expect(stepLabel(todos)).toBe("Step 2 of 2");
  });

  it("reads the last step when everything is done", () => {
    const todos = [todo("completed"), todo("completed")];
    expect(stepLabel(todos)).toBe("Step 2 of 2");
  });

  it("says nothing without steps", () => {
    expect(stepLabel([])).toBeNull();
  });
});
