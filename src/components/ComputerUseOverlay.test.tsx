// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ComputerUseConfig } from "../lib/api";

const mocks = vi.hoisted(() => ({
  computerUseConfig: vi.fn(),
  computerUseSetPaused: vi.fn(),
  computerUseSetOverlay: vi.fn(),
  hide: vi.fn(),
}));

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return {
    ...actual,
    computerUseConfig: mocks.computerUseConfig,
    computerUseSetPaused: mocks.computerUseSetPaused,
    computerUseSetOverlay: mocks.computerUseSetOverlay,
  };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ hide: mocks.hide }),
}));

import { ComputerUseOverlay } from "./ComputerUseOverlay";

const base: ComputerUseConfig = {
  enabled: true,
  paused: false,
  dry_run: false,
  overlay: true,
  hotkey: "Ctrl+Alt+Shift+P",
  max_actions_per_run: 100,
  audit_thumbnails: true,
  allow: [],
  deny: [],
};

describe("ComputerUseOverlay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.computerUseConfig.mockResolvedValue(base);
    mocks.computerUseSetPaused.mockImplementation(async (paused: boolean) => ({ ...base, paused }));
    mocks.computerUseSetOverlay.mockImplementation(async (overlay: boolean) => ({ ...base, overlay }));
  });

  afterEach(cleanup);

  it("pauses from the overlay", async () => {
    render(<ComputerUseOverlay />);

    fireEvent.click(await screen.findByRole("button", { name: "Pause computer use" }));

    await waitFor(() => expect(mocks.computerUseSetPaused).toHaveBeenCalledWith(true));
    expect(mocks.hide).not.toHaveBeenCalled();
  });

  it("hides itself and turns the overlay setting off", async () => {
    render(<ComputerUseOverlay />);

    fireEvent.click(await screen.findByRole("button", { name: "Hide computer-use overlay" }));

    await waitFor(() => expect(mocks.computerUseSetOverlay).toHaveBeenCalledWith(false));
    expect(mocks.hide).toHaveBeenCalled();
  });
});
