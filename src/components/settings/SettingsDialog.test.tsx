// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { setSettingsPage } = vi.hoisted(() => ({
  setSettingsPage: vi.fn(),
}));

vi.mock("../../lib/store", () => ({
  useApp: () => ({ settingsPage: "general", setSettingsPage }),
}));

vi.mock("../../lib/useFocusTrap", () => ({ useFocusTrap: () => undefined }));

vi.mock("./ProvidersPage", () => ({ ProvidersPage: () => "Providers" }));
vi.mock("./ChangelogPage", () => ({ ChangelogPage: () => "Changelog" }));
vi.mock("./SandboxPage", () => ({ SandboxPage: () => "Sandbox" }));
vi.mock("./SkillsPage", () => ({ SkillsPage: () => "Skills" }));
vi.mock("./VoicePage", () => ({ VoicePage: () => "Voice" }));
vi.mock("./SimplePages", () => ({
  AboutPage: () => "About",
  AppearancePage: () => "Appearance",
  AuditPage: () => "Audit",
  ComputerUsePage: () => "Computer use",
  DataPage: () => "Data",
  GeneralPage: () => "General content",
  McpPage: () => "MCP",
  MemoryPage: () => "Memory",
  ModelsPage: () => "Models",
  SearchPage: () => "Search",
  ShortcutsPage: () => "Shortcuts",
}));

import { SettingsDialog } from "./SettingsDialog";

afterEach(() => {
  cleanup();
  setSettingsPage.mockClear();
});

describe("SettingsDialog layout", () => {
  it("uses the expanded desktop viewport with vertical breathing room", () => {
    render(<SettingsDialog />);

    const dialog = screen.getByRole("dialog", { name: "Settings" });
    const content = screen.getByRole("region", { name: "Settings content" });

    expect(dialog.className).toContain("h-[min(800px,92dvh)]");
    expect(dialog.className).toContain("w-[min(1200px,96vw)]");
    expect(content.className).toContain("py-6");
  });

  it("keeps the close control outside the scrolling content", () => {
    render(<SettingsDialog />);

    const content = screen.getByRole("region", { name: "Settings content" });
    const close = screen.getByRole("button", { name: "Close settings" });

    expect(content.contains(close)).toBe(false);
    fireEvent.click(close);
    expect(setSettingsPage).toHaveBeenCalledWith(null);
  });
});
