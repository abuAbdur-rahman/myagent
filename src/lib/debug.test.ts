import { beforeEach, describe, expect, it, vi } from "vitest";

const { append } = vi.hoisted(() => ({
  append: vi.fn(async (_line: string) => undefined),
}));

vi.mock("./api", () => ({ debugLogAppend: append }));

import { debugReport, logEvent } from "./debug";

function lastLine(): string {
  const call = append.mock.calls[append.mock.calls.length - 1];
  return call?.[0] ?? "";
}

beforeEach(() => {
  append.mockClear();
});

describe("logEvent", () => {
  it("records a fixed kind with a redacted error message", async () => {
    logEvent("error", new Error("401 for sk-or-v1-sentinel-secret-value-9f3a"));
    await vi.waitFor(() => expect(append).toHaveBeenCalled());

    const line = lastLine();
    expect(line).toContain("error");
    expect(line).toContain("sk-[redacted]");
    expect(line).not.toContain("sentinel");
    expect(line).not.toContain("9f3a");
  });

  it("redacts bearer tokens, key parameters and key-shaped fields", async () => {
    logEvent(
      "unhandledrejection",
      'request failed: Bearer abcdefghijklmnop api_key=tvly-1234abcd {"token":"opaque-value"}',
    );
    await vi.waitFor(() => expect(append).toHaveBeenCalled());

    const line = lastLine();
    expect(line).toContain("Bearer [redacted]");
    expect(line).toContain("api_key=[redacted]");
    expect(line).toContain('"token":"[redacted]"');
    expect(line).not.toContain("abcdefghijklmnop");
    expect(line).not.toContain("tvly-1234abcd");
    expect(line).not.toContain("opaque-value");
  });

  it("redacts tokens that are not shaped like an API key", async () => {
    logEvent(
      "error",
      'auth failed {"access_token":"opaque-access","client_secret":"opaque-client"} password=hunter2 password: hunter2hunter2 github_pat_11ABCDEFGHIJKLMNOPQRSTUV xoxb-1234567890-abcdef deploy token is hunter3hunter3',
    );
    await vi.waitFor(() => expect(append).toHaveBeenCalled());

    const line = lastLine();
    for (const secret of [
      "opaque-access",
      "opaque-client",
      "hunter2hunter2",
      "github_pat_11ABCDEFGHIJKLMNOPQRSTUV",
      "xoxb-1234567890-abcdef",
      "hunter3hunter3",
    ]) {
      expect(line).not.toContain(secret);
    }
    expect(line).toContain('"access_token":"[redacted]"');
    expect(line).toContain("password=[redacted]");
  });

  it("redacts environment, escaped JSON and Basic authorization values", async () => {
    logEvent(
      "error",
      String.raw`OPENAI_API_KEY=env-secret AWS_SECRET_ACCESS_KEY=aws-secret {\"access_token\":\"escaped-secret\"} Authorization: Basic dXNlcjpwYXNz`,
    );
    await vi.waitFor(() => expect(append).toHaveBeenCalled());

    const line = lastLine();
    for (const secret of ["env-secret", "aws-secret", "escaped-secret", "dXNlcjpwYXNz"]) {
      expect(line).not.toContain(secret);
    }
  });

  it("keeps the newest events when the buffer is full", async () => {
    for (let index = 0; index <= 320; index += 1) {
      logEvent("window.error", `failure ${index}`);
    }
    const report = debugReport({});
    expect(report).toContain("failure 320");
    expect(report).not.toContain("failure 240");
  });
});

describe("debugReport", () => {
  it("includes recent events without leaking a key", async () => {
    logEvent("window.error", "boom sk-proj-abcdefghijkl");
    await vi.waitFor(() => expect(append).toHaveBeenCalled());

    const report = debugReport({
      version: "0.12.0",
      connection: "sk-or-v1-abcdefghijkl",
      model: "test/model",
      theme: "dark",
    });

    expect(report).toContain("MyAgent 0.12.0");
    expect(report).toContain("Recent events:");
    expect(report).not.toContain("abcdefghijkl");
  });
});
