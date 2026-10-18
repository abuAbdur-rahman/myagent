import { beforeAll, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { AppProvider, settleToolLog, toolLogPatch } from "./store";
import type { ToolLogEntry } from "./types";

const memory = new Map<string, string>();

beforeAll(() => {
  const storage: Storage = {
    get length() {
      return memory.size;
    },
    clear: () => memory.clear(),
    getItem: (key) => memory.get(key) ?? null,
    key: (index) => Array.from(memory.keys())[index] ?? null,
    removeItem: (key) => {
      memory.delete(key);
    },
    setItem: (key, value) => {
      memory.set(key, value);
    },
  };
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true });
});

describe("AppProvider", () => {
  it("renders its first paint without throwing", () => {
    expect(() =>
      renderToString(createElement(AppProvider, null, createElement("div"))),
    ).not.toThrow();
  });
});

describe("tool log memo on the message", () => {
  const entry = (status: ToolLogEntry["status"]): ToolLogEntry => ({
    id: "t1",
    name: "web_search",
    summary: "Search: rust",
    status,
    preview: null,
  });

  it("stores the log as JSON so a finished turn keeps it", () => {
    const patch = toolLogPatch([entry("ok")]);
    expect(typeof patch.tool_log).toBe("string");
    expect(JSON.parse(patch.tool_log ?? "")).toHaveLength(1);
  });

  it("stores an empty log as null", () => {
    expect(toolLogPatch([]).tool_log).toBeNull();
  });

  it("settles a running entry as interrupted", () => {
    const settled = settleToolLog([entry("running"), entry("ok")]);
    expect(settled[0].status).toBe("err");
    expect(settled[0].preview).toBe("Interrupted");
    expect(settled[1].status).toBe("ok");
  });

  it("keeps a settled log referentially stable", () => {
    const entries = [entry("ok"), entry("err")];
    expect(settleToolLog(entries)).toEqual(entries);
    expect(settleToolLog(entries)[0]).toBe(entries[0]);
  });
});
