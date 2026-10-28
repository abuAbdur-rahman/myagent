// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  saveConnection: vi.fn(),
  removeConnection: vi.fn(),
  refreshConnections: vi.fn(),
  selectConnection: vi.fn(),
  setApiKey: vi.fn(),
  addProviderKey: vi.fn(),
  verifyProvider: vi.fn(),
}));

vi.mock("../../lib/store", () => ({
  useApp: () => ({
    saveConnection: mocks.saveConnection,
    removeConnection: mocks.removeConnection,
    refreshConnections: mocks.refreshConnections,
    selectConnection: mocks.selectConnection,
  }),
}));

vi.mock("../../lib/api", () => ({
  setApiKey: mocks.setApiKey,
  addProviderKey: mocks.addProviderKey,
  verifyProvider: mocks.verifyProvider,
  classifyStreamError: () => ({ hint: "Provider error. Raw message below." }),
  formatInvokeError: (error: unknown) => {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    if (error && typeof error === "object") {
      const entry = Object.entries(error)[0];
      if (entry) return `${entry[0].toLowerCase()}: ${String(entry[1])}`;
    }
    return "Something went wrong.";
  },
}));

vi.mock("../../lib/db", () => ({
  markKeyTested: vi.fn(async () => undefined),
}));

import { ProviderDialog } from "./ProvidersPage";

const savedConnection = {
  id: "conn-1",
  name: "OpenRouter",
  base_url: "https://openrouter.ai/api/v1",
  kind: "openrouter" as const,
  default_model: null,
  created_at: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.saveConnection.mockResolvedValue(savedConnection);
  mocks.setApiKey.mockResolvedValue(undefined);
  mocks.addProviderKey.mockResolvedValue(1);
});

afterEach(cleanup);

describe("ProviderDialog", () => {
  it("keeps a new provider when the model check fails", async () => {
    mocks.verifyProvider.mockRejectedValue({ Upstream: "HTTP 401 — invalid key" });
    const onResult = vi.fn();

    render(
      <ProviderDialog
        open
        connection={null}
        onClose={vi.fn()}
        onResult={onResult}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("sk-…"), {
      target: { value: "sk-test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText(/model check failed/i)).toBeTruthy();
    });

    expect(mocks.removeConnection).not.toHaveBeenCalled();
    expect(mocks.selectConnection).not.toHaveBeenCalled();
    expect(mocks.saveConnection).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "openrouter" }),
      undefined,
      { activate: false },
    );
    expect(screen.getByRole("button", { name: "Retry test" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Keep provider" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete provider" })).toBeTruthy();
    expect(onResult).toHaveBeenCalledWith(
      "conn-1",
      expect.objectContaining({ ok: false }),
    );
  });

  it("adds another key when editing an existing provider", async () => {
    mocks.verifyProvider.mockResolvedValue(1);

    render(
      <ProviderDialog
        open
        connection={savedConnection}
        onClose={vi.fn()}
        onResult={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("Leave blank, or add another key"), {
      target: { value: "sk-second" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocks.addProviderKey).toHaveBeenCalledWith("conn-1", "sk-second"));
    expect(mocks.setApiKey).not.toHaveBeenCalled();
  });

  it("keeps the saved draft after a successful test", async () => {
    mocks.verifyProvider.mockResolvedValue(1);
    const onClose = vi.fn();

    render(
      <ProviderDialog
        open
        connection={null}
        onClose={onClose}
        onResult={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("sk-…"), {
      target: { value: "sk-test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));

    await waitFor(() => {
      expect(screen.getByText(/Connected · 1 models found/)).toBeTruthy();
    });
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.saveConnection).toHaveBeenCalledTimes(2);
    expect(mocks.saveConnection.mock.calls[1]?.[1]).toBe("conn-1");
  });

  it("keeps an existing draft when a retry cannot save its key", async () => {
    mocks.verifyProvider.mockRejectedValue(new Error("model check failed"));
    mocks.addProviderKey.mockRejectedValueOnce(new Error("vault down"));

    render(
      <ProviderDialog
        open
        connection={null}
        onClose={vi.fn()}
        onResult={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText("sk-…"), {
      target: { value: "sk-test" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText(/model check failed/i)).toBeTruthy();
    });
    expect(mocks.removeConnection).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText("sk-…"), {
      target: { value: "sk-retry" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Retry test" }));

    await waitFor(() => {
      expect(screen.getByText(/Couldn't save the key/i)).toBeTruthy();
    });
    expect(mocks.removeConnection).not.toHaveBeenCalled();
    expect(mocks.saveConnection).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: "openrouter" }),
      "conn-1",
      { activate: false },
    );
  });
});
