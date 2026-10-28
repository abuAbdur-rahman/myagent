import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
  Channel: class {},
}));

import { clearModelCache, listModels } from "./api";

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

beforeEach(() => {
  memory.clear();
  invokeMock.mockReset();
});

describe("model list cache", () => {
  it("returns a cached list without invoking the backend again", async () => {
    invokeMock.mockResolvedValue(["alpha", "beta"]);

    expect(await listModels("conn-1", "openrouter")).toEqual(["alpha", "beta"]);
    expect(await listModels("conn-1", "openrouter")).toEqual(["alpha", "beta"]);
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("expires a cached list after ten hours", async () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000_000);
    try {
      invokeMock.mockResolvedValueOnce(["old"]).mockResolvedValueOnce(["new"]);

      await listModels("conn-1", "openrouter");
      now.mockReturnValue(1_000_000 + 10 * 60 * 60 * 1000 - 1);
      expect(await listModels("conn-1", "openrouter")).toEqual(["old"]);
      expect(invokeMock).toHaveBeenCalledTimes(1);

      now.mockReturnValue(1_000_000 + 10 * 60 * 60 * 1000);
      expect(await listModels("conn-1", "openrouter")).toEqual(["new"]);
      expect(invokeMock).toHaveBeenCalledTimes(2);
    } finally {
      now.mockRestore();
    }
  });

  it("forces a backend read when asked", async () => {
    invokeMock.mockResolvedValueOnce(["old"]).mockResolvedValueOnce(["new"]);

    expect(await listModels("conn-1", "openrouter")).toEqual(["old"]);
    expect(await listModels("conn-1", "openrouter", true)).toEqual(["new"]);
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenLastCalledWith("list_models", {
      connectionId: "conn-1",
      connectionKind: "openrouter",
      force: true,
    });
  });

  it("does not cache an empty list", async () => {
    invokeMock.mockResolvedValueOnce([]).mockResolvedValueOnce(["alpha"]);

    expect(await listModels("conn-1", "openrouter")).toEqual([]);
    expect(await listModels("conn-1", "openrouter")).toEqual(["alpha"]);
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("does not repopulate the cache when an in-flight request outlives invalidation", async () => {
    let resolve: (models: string[]) => void = () => undefined;
    invokeMock.mockReturnValueOnce(
      new Promise<string[]>((done) => {
        resolve = done;
      }),
    );

    const pending = listModels("conn-1", "openrouter");
    clearModelCache("conn-1");
    resolve(["stale"]);
    expect(await pending).toEqual(["stale"]);

    invokeMock.mockResolvedValueOnce(["fresh"]);
    expect(await listModels("conn-1", "openrouter")).toEqual(["fresh"]);
    expect(invokeMock).toHaveBeenCalledTimes(2);
  });

  it("invalidates one connection without touching another", async () => {
    invokeMock.mockResolvedValue(["one"]);
    await listModels("conn-1", "openrouter");
    await listModels("conn-2", "openrouter");
    expect(invokeMock).toHaveBeenCalledTimes(2);

    clearModelCache("conn-1");
    await listModels("conn-1", "openrouter");
    expect(invokeMock).toHaveBeenCalledTimes(3);
    await listModels("conn-2", "openrouter");
    expect(invokeMock).toHaveBeenCalledTimes(3);
  });

  it("invalidates every connection when no id is given", async () => {
    invokeMock.mockResolvedValue(["one"]);
    await listModels("conn-1", "openrouter");
    await listModels("conn-2", "openrouter");
    expect(invokeMock).toHaveBeenCalledTimes(2);

    clearModelCache();
    await listModels("conn-1", "openrouter");
    await listModels("conn-2", "openrouter");
    expect(invokeMock).toHaveBeenCalledTimes(4);
  });
});
