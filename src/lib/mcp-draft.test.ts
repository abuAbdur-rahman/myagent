import { describe, expect, it } from "vitest";

import { mcpTargetArgs, mcpTargetError, type McpDraft } from "./mcp-draft";

function draft(overrides: Partial<McpDraft>): McpDraft {
  return {
    name: "server",
    transport: "stdio",
    authType: "none",
    command: "",
    url: "",
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
