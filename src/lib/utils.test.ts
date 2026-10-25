import { describe, expect, it } from "vitest";
import { errorText, rollbackConnection } from "./utils";

describe("errorText", () => {
  it("keeps an Error message", () => {
    expect(errorText(new Error("HTTP 401 — bad key"))).toBe("HTTP 401 — bad key");
  });

  it("unwraps a serialized Tauri AppError", () => {
    expect(errorText({ Upstream: "HTTP 405 — ollama.com rejected this key" })).toBe(
      "upstream: HTTP 405 — ollama.com rejected this key",
    );
  });

  it("keeps a plain string", () => {
    expect(errorText("network unreachable")).toBe("network unreachable");
  });
});

describe("rollbackConnection", () => {
  it("returns null after a successful delete", async () => {
    const removed: string[] = [];
    await expect(
      rollbackConnection(async (id) => {
        removed.push(id);
      }, "conn-1"),
    ).resolves.toBeNull();
    expect(removed).toEqual(["conn-1"]);
  });

  it("returns the delete error instead of swallowing it", async () => {
    await expect(
      rollbackConnection(async () => {
        throw { Database: "database is locked" };
      }, "conn-1"),
    ).resolves.toBe("database: database is locked");
  });

  it("does nothing when there is no row", async () => {
    await expect(rollbackConnection(async () => undefined, null)).resolves.toBeNull();
  });
});
