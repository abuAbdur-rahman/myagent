import { describe, expect, it } from "vitest";

import {
  mcpConfigFromDraft,
  mcpDraftFromConfig,
  mcpTargetArgs,
  mcpTargetError,
  type McpDraft,
} from "./mcp-draft";

function draft(overrides: Partial<McpDraft>): McpDraft {
  return {
    name: "server",
    transport: "stdio",
    authType: "none",
    command: "",
    url: "",
    args: "",
    cwd: "",
    env: "",
    headers: "",
    timeoutMs: "",
    ...overrides,
  };
}

describe("mcpTargetArgs", () => {
  it("maps a stdio command to cmd and clears url", () => {
    expect(mcpTargetArgs(draft({ command: " npx srv " }))).toEqual({
      cmd: "npx srv",
      url: null,
    });
  });

  it("maps a Streamable HTTP URL to url and clears cmd", () => {
    expect(
      mcpTargetArgs(
        draft({ transport: "http", command: "ignored", url: " https://example.com/mcp " }),
      ),
    ).toEqual({ cmd: null, url: "https://example.com/mcp" });
  });

  it("maps a legacy SSE URL to url and clears cmd", () => {
    expect(
      mcpTargetArgs(
        draft({ transport: "sse", command: "ignored", url: "https://example.com/sse" }),
      ),
    ).toEqual({ cmd: null, url: "https://example.com/sse" });
  });
});

describe("mcpTargetError", () => {
  it("requires a command for stdio", () => {
    expect(mcpTargetError(draft({ command: "  " }))).toBe("Command is required.");
  });

  it("accepts a command without a URL scheme for stdio", () => {
    expect(mcpTargetError(draft({ command: "npx srv" }))).toBeNull();
  });

  it("requires a URL for http and sse", () => {
    expect(mcpTargetError(draft({ transport: "http", url: "  " }))).toBe("URL is required.");
    expect(mcpTargetError(draft({ transport: "sse", url: "" }))).toBe("URL is required.");
  });

  it("rejects a URL without an http scheme for http and sse", () => {
    expect(mcpTargetError(draft({ transport: "http", url: "example.com/mcp" }))).toBe(
      "URL must start with http:// or https://.",
    );
    expect(mcpTargetError(draft({ transport: "sse", url: "ws://example.com/sse" }))).toBe(
      "URL must start with http:// or https://.",
    );
  });

  it("accepts http and https URLs for http and sse", () => {
    expect(mcpTargetError(draft({ transport: "http", url: "http://localhost:8000/mcp" }))).toBeNull();
    expect(mcpTargetError(draft({ transport: "sse", url: "https://example.com/sse" }))).toBeNull();
  });
});

describe("mcpConfigFromDraft", () => {
  it("builds a stdio config with args, env, cwd and timeout", () => {
    expect(
      mcpConfigFromDraft(
        draft({
          command: "npx",
          args: "-y\nserver\n",
          cwd: " C:\\work ",
          env: "NODE_ENV=production\nTOKEN=",
          timeoutMs: "5000",
        }),
      ),
    ).toEqual({
      command: "npx",
      args: ["-y", "server"],
      cwd: "C:\\work",
      env: { NODE_ENV: "production", TOKEN: "" },
      url: null,
      headers: {},
      timeout_ms: 5000,
    });
  });

  it("builds an HTTP config with headers", () => {
    expect(
      mcpConfigFromDraft(
        draft({
          transport: "http",
          url: " https://example.com/mcp ",
          headers: "Authorization=\nX-Client=myagent",
        }),
      ),
    ).toEqual({
      command: null,
      args: [],
      cwd: null,
      env: {},
      url: "https://example.com/mcp",
      headers: { Authorization: "", "X-Client": "myagent" },
      timeout_ms: null,
    });
  });

  it("rejects malformed pairs and timeouts", () => {
    expect(() => mcpConfigFromDraft(draft({ env: "NO_EQUALS" }))).toThrow("KEY=VALUE");
    expect(() => mcpConfigFromDraft(draft({ timeoutMs: "0" }))).toThrow("Timeout");
  });
});

describe("mcpDraftFromConfig", () => {
  it("keeps stored values blank and formats args", () => {
    expect(
      mcpDraftFromConfig(
        { name: "server", transport: "stdio", authType: "none" },
        {
          command: "npx",
          args: ["-y", "server"],
          cwd: "C:\\work",
          env: { TOKEN: "" },
          url: null,
          headers: {},
          timeout_ms: 5000,
        },
      ),
    ).toMatchObject({
      command: "npx",
      args: "-y\nserver",
      cwd: "C:\\work",
      env: "TOKEN=",
      headers: "",
      timeoutMs: "5000",
    });
  });
});
