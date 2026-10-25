// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { McpServerRow } from "../../lib/api";

const mocks = vi.hoisted(() => ({
  mcpSetToken: vi.fn(),
  mcpDeleteToken: vi.fn(),
  mcpBeginAuth: vi.fn(),
  mcpCancelAuth: vi.fn(),
  mcpDisconnect: vi.fn(),
}));

vi.mock("../../lib/api", () => ({
  mcpSetToken: mocks.mcpSetToken,
  mcpDeleteToken: mocks.mcpDeleteToken,
  mcpBeginAuth: mocks.mcpBeginAuth,
  mcpCancelAuth: mocks.mcpCancelAuth,
  mcpDisconnect: mocks.mcpDisconnect,
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

const oauthRow: McpServerRow = { ...row, auth_type: "oauth" };

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

describe("McpServerDialog oauth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.mcpBeginAuth.mockResolvedValue({ ...oauthRow, has_token: true });
    mocks.mcpDisconnect.mockResolvedValue({ ...oauthRow, has_token: false });
    mocks.mcpCancelAuth.mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it("connects through the browser and refreshes the parent list", async () => {
    const onChanged = vi.fn();
    render(
      <McpServerDialog
        open
        editing={oauthRow}
        seed={null}
        servers={[oauthRow]}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onChanged={onChanged}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    await waitFor(() => expect(mocks.mcpBeginAuth).toHaveBeenCalledWith("s1"));
    expect(onChanged).toHaveBeenCalled();
    expect(await screen.findByText("Connected.")).toBeTruthy();
  });

  it("requires saving a changed target before connecting", () => {
    render(
      <McpServerDialog
        open
        editing={oauthRow}
        seed={null}
        servers={[oauthRow]}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onChanged={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByDisplayValue("https://example.com/mcp"), {
      target: { value: "https://other.example/mcp" },
    });

    expect(screen.getByText("Save the server before connecting.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Connect" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("cancels a pending authorization when the dialog closes", async () => {
    let finish: (row: McpServerRow) => void = () => {};
    mocks.mcpBeginAuth.mockReturnValue(
      new Promise<McpServerRow>((resolve) => {
        finish = resolve;
      }),
    );
    const { rerender } = render(
      <McpServerDialog
        open
        editing={oauthRow}
        seed={null}
        servers={[oauthRow]}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onChanged={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Connect" }));
    await waitFor(() => expect(mocks.mcpBeginAuth).toHaveBeenCalledWith("s1"));

    rerender(
      <McpServerDialog
        open={false}
        editing={oauthRow}
        seed={null}
        servers={[oauthRow]}
        onClose={vi.fn()}
        onSave={vi.fn()}
        onChanged={vi.fn()}
      />,
    );

    await waitFor(() => expect(mocks.mcpCancelAuth).toHaveBeenCalledWith("s1"));
    finish({ ...oauthRow, has_token: true });
  });

  it("clears stored oauth credentials on disconnect", async () => {
    const stored = { ...oauthRow, has_token: true };
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

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    await waitFor(() => expect(mocks.mcpDisconnect).toHaveBeenCalledWith("s1"));
    expect(await screen.findByText("Disconnected.")).toBeTruthy();
  });

  it("does not offer cancel while disconnecting", async () => {
    let finish: (row: McpServerRow) => void = () => {};
    mocks.mcpDisconnect.mockReturnValue(
      new Promise<McpServerRow>((resolve) => {
        finish = resolve;
      }),
    );
    const stored = { ...oauthRow, has_token: true };
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

    fireEvent.click(screen.getByRole("button", { name: "Disconnect" }));

    await waitFor(() => expect(mocks.mcpDisconnect).toHaveBeenCalledWith("s1"));
    expect(screen.getAllByRole("button", { name: "Cancel" })).toHaveLength(1);
    finish({ ...oauthRow, has_token: false });
  });
});
