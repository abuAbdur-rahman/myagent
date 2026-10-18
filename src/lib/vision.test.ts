import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  applyVisionOverride,
  readVisionFallback,
  readVisionOverrides,
  visionOverrideFor,
  withVisionOverride,
  writeVisionFallback,
  writeVisionOverride,
} from "./vision";

const storage = new Map<string, string>();

beforeEach(() => {
  storage.clear();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => {
      storage.set(key, value);
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
    key: (index: number) => [...storage.keys()][index] ?? null,
    get length() {
      return storage.size;
    },
  });
});

describe("vision fallback", () => {
  it("round-trips a fallback with its connection", () => {
    writeVisionFallback({ connectionId: "conn-1", model: "gpt-4o" });
    expect(readVisionFallback()).toEqual({ connectionId: "conn-1", model: "gpt-4o" });
  });

  it("reads a legacy bare model as the active connection", () => {
    localStorage.setItem("visionFallbackModel", "claude-3-5-sonnet");
    expect(readVisionFallback()).toEqual({ connectionId: "", model: "claude-3-5-sonnet" });
  });

  it("drops the legacy key and the current one when cleared", () => {
    localStorage.setItem("visionFallbackModel", "old-model");
    writeVisionFallback(null);
    expect(localStorage.getItem("visionFallbackModel")).toBeNull();
    expect(readVisionFallback()).toBeNull();
  });
});

describe("vision overrides", () => {
  it("stores and reads an override per connection and model", () => {
    writeVisionOverride("conn-1", "deepseek-chat", "yes");
    expect(readVisionOverrides()).toEqual({ "conn-1::deepseek-chat": "yes" });
    expect(visionOverrideFor(readVisionOverrides(), "conn-1", "deepseek-chat")).toBe("yes");
    expect(visionOverrideFor(readVisionOverrides(), "conn-2", "deepseek-chat")).toBeNull();
  });

  it("removes the key when the override is cleared", () => {
    writeVisionOverride("conn-1", "gpt-4o", "no");
    writeVisionOverride("conn-1", "gpt-4o", null);
    expect(readVisionOverrides()).toEqual({});
  });

  it("ignores a stored value it does not recognise", () => {
    localStorage.setItem("visionOverride:conn-1::odd", "maybe");
    expect(readVisionOverrides()).toEqual({});
  });

  it("applies a change without mutating the previous map", () => {
    const before = { "conn-1::a": "yes" as const };
    const after = withVisionOverride(before, "conn-1", "b", "no");
    expect(before).toEqual({ "conn-1::a": "yes" });
    expect(after).toEqual({ "conn-1::a": "yes", "conn-1::b": "no" });
  });

  it("lets an override decide either way and falls through when unset", () => {
    expect(applyVisionOverride(false, "yes")).toBe(true);
    expect(applyVisionOverride(true, "no")).toBe(false);
    expect(applyVisionOverride(true, null)).toBe(true);
    expect(applyVisionOverride(false, null)).toBe(false);
  });
});
