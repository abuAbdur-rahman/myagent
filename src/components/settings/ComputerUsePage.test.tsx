// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ComputerUseConfig } from "../../lib/api";

const mocks = vi.hoisted(() => ({
  computerUseConfig: vi.fn(),
  computerUseSetConfig: vi.fn(),
  computerUseHardDenies: vi.fn(),
  computerUseAudit: vi.fn(),
  computerUseClearAudit: vi.fn(),
  computerUseAuditImage: vi.fn(),
}));

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return { ...actual, ...mocks };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

import { ComputerUsePage } from "./SimplePages";

const base: ComputerUseConfig = {
  enabled: false,
  paused: false,
  dry_run: false,
  overlay: true,
  hotkey: "Ctrl+Alt+Shift+P",
  max_actions_per_run: 100,
  audit_thumbnails: true,
  allow: [],
  deny: [],
};

describe("ComputerUsePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.computerUseConfig.mockResolvedValue(base);
    mocks.computerUseHardDenies.mockResolvedValue(["cmd.exe is a hard-denied app"]);
    mocks.computerUseAudit.mockResolvedValue([]);
    mocks.computerUseSetConfig.mockImplementation(async (config: ComputerUseConfig) => config);
  });

  afterEach(cleanup);

  it("adds an allowlisted app and saves it", async () => {
    render(<ComputerUsePage />);

    expect(await screen.findByText("No apps allowed yet.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("App process name"), {
      target: { value: "notepad.exe" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add" }));

    expect(await screen.findByText("notepad.exe")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(mocks.computerUseSetConfig).toHaveBeenCalledTimes(1));
    const saved = mocks.computerUseSetConfig.mock.calls[0][0] as ComputerUseConfig;
    expect(saved.allow).toEqual([
      { path: "", name: "notepad.exe", tier: "view", publisher: null },
    ]);
  });
});
