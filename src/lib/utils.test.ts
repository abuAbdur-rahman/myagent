import { describe, expect, it } from "vitest";
import { errorText, formatDuration, rollbackConnection } from "./utils";

describe("formatDuration", () => {
  it("shows one decimal below a minute", () => {
    expect(formatDuration(26_700)).toBe("26.7s");
    expect(formatDuration(4_200)).toBe("4.2s");
  });

  it("shows minutes and seconds", () => {
    expect(formatDuration(33 * 60_000 + 42_000)).toBe("33m 42s");
    expect(formatDuration(1_800_000)).toBe("30m");
  });

  it("shows hours and minutes", () => {
    expect(formatDuration(3_720_000)).toBe("1h 2m");
    expect(formatDuration(7_200_000)).toBe("2h");
  });

  it("rejects invalid input", () => {
    expect(formatDuration(-1)).toBe("");
    expect(formatDuration(Number.NaN)).toBe("");
  });
});

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
