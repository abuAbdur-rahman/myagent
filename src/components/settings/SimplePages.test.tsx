// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { McpServerRow } from "../../lib/api";

const mocks = vi.hoisted(() => ({
  mcpSetToken: vi.fn(),
  mcpDeleteToken: vi.fn(),
}));

vi.mock("../../lib/api", () => ({
  mcpSetToken: mocks.mcpSetToken,
  mcpDeleteToken: mocks.mcpDeleteToken,
  mcpTest: vi.fn(),
  mcpList: vi.fn(),
  mcpStatus: vi.fn(),
}));

vi.mock("../../lib/store", () => ({
  useApp: () => ({ activeProject: null }),
}));

import { McpServerDialog } from "./SimplePages";

const row: McpServerRow = {
  id: "s1",
  project_id: null,
  name: "remote",
  transport: "http",
  auth_type: "bearer",
  cmd: null,
  url: "https://example.com/mcp",
  allow_tools: null,
  deny_tools: null,
  ask_tools: null,
  approval_mode: "ask",
  timeout_ms: null,
  enabled: true,
  has_token: false,
};

describe("McpServerDialog bearer token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mcpSetToken.mockResolvedValue({ ...row, has_token: true });
    mocks.mcpDeleteToken.mockResolvedValue({ ...row, has_token: false });
  });

  afterEach(cleanup);

  it("saves the token without putting it in the server draft", async () => {
    const onChanged = vi.fn();
    render(
      <McpServerDialog
        open
        editing={row}
        seed={null}
        servers={[row]}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onChanged={onChanged}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Paste token"), {
      target: { value: "secret-token" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save token" }));

    await waitFor(() => expect(mocks.mcpSetToken).toHaveBeenCalledWith("s1", "secret-token"));
    expect(onChanged).toHaveBeenCalled();
    expect(await screen.findByText("Token saved. Reconnect to use it.")).toBeTruthy();
  });

  it("clears a stored token", async () => {
    const stored = { ...row, has_token: true };
    render(
      <McpServerDialog
        open
        editing={stored}
        seed={null}
        servers={[stored]}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onChanged={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear token" }));

    await waitFor(() => expect(mocks.mcpDeleteToken).toHaveBeenCalledWith("s1"));
    expect(await screen.findByText("Token cleared.")).toBeTruthy();
  });
});
