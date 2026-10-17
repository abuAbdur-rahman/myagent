import { beforeAll, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { AppProvider } from "./store";

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
