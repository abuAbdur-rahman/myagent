import { describe, expect, it, vi } from "vitest";

import {
  dispatchSlash,
  matchSlash,
  parseSlash,
  resolveExportFormat,
  resolveModelArg,
  SLASH_COMMANDS,
  type SlashHandlers,
} from "./slash";

function handlers() {
  const calls: Record<string, string> = {};
  const record =
    (name: string) =>
    (args: string) => {
      calls[name] = args;
    };
  const value: SlashHandlers = {
    new: record("new"),
    clear: record("clear"),
    compact: record("compact"),
    export: record("export"),
    model: record("model"),
    memory: record("memory"),
    settings: record("settings"),
  };
  return { value, calls };
}

describe("parseSlash", () => {
  it("parses a bare command", () => {
    expect(parseSlash("/compact")).toEqual({ name: "compact", args: "" });
  });
  it("parses a command with args", () => {
    expect(parseSlash("/model gpt-4o")).toEqual({ name: "model", args: "gpt-4o" });
  });
  it("rejects non-commands", () => {
    expect(parseSlash("hello")).toBeNull();
    expect(parseSlash("/ model")).toBeNull();
  });
});

describe("matchSlash", () => {
  it("filters by prefix", () => {
    const names = matchSlash("/c").map((command) => command.name);
    expect(names).toEqual(["clear", "compact"]);
  });
  it("lists the registry", () => {
    expect(SLASH_COMMANDS.map((command) => command.name)).toEqual([
      "new",
      "clear",
      "compact",
      "export",
      "model",
      "memory",
      "settings",
    ]);
  });
});

describe("resolveExportFormat", () => {
  it("defaults to markdown and accepts json", () => {
    expect(resolveExportFormat("")).toBe("md");
    expect(resolveExportFormat("markdown")).toBe("md");
    expect(resolveExportFormat("json")).toBe("json");
  });
  it("rejects unknown formats", () => {
    expect(resolveExportFormat("xml")).toBeNull();
  });
});

describe("resolveModelArg", () => {
  const models = ["gpt-4o", "claude-opus", "claude-sonnet"];
  it("opens the picker with no args", () => {
    expect(resolveModelArg("", models)).toEqual({ kind: "picker" });
  });
  it("sets an exact match", () => {
    expect(resolveModelArg("gpt-4o", models)).toEqual({ kind: "set", id: "gpt-4o" });
  });
  it("sets a unique substring", () => {
    expect(resolveModelArg("opus", models)).toEqual({ kind: "set", id: "claude-opus" });
  });
  it("reports unknown and ambiguous", () => {
    expect(resolveModelArg("gemini", models)).toEqual({ kind: "unknown" });
    expect(resolveModelArg("claude", models)).toEqual({
      kind: "ambiguous",
      matches: ["claude-opus", "claude-sonnet"],
    });
  });
});

describe("dispatchSlash", () => {
  it("routes a command and never sends it as chat", () => {
    const { value, calls } = handlers();
    const sendMessage = vi.fn();
    const handled = dispatchSlash("/compact", value);
    if (!handled) sendMessage("/compact");
    expect(handled).toBe(true);
    expect(calls.compact).toBe("");
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("passes args through", () => {
    const { value, calls } = handlers();
    dispatchSlash("/model gpt-4o", value);
    expect(calls.model).toBe("gpt-4o");
  });

  it("leaves unknown text for the chat", () => {
    const { value } = handlers();
    expect(dispatchSlash("/compactx", value)).toBe(false);
    expect(dispatchSlash("hello world", value)).toBe(false);
  });
});
