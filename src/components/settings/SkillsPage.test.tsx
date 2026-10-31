// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SkillDoctorResult, SkillInfo } from "../../lib/api";

const mocks = vi.hoisted(() => ({
  skillsList: vi.fn(),
  skillsSetEnabled: vi.fn(),
  skillsDoctor: vi.fn(),
  openPath: vi.fn(),
}));

vi.mock("../../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/api")>();
  return {
    ...actual,
    skillsList: mocks.skillsList,
    skillsSetEnabled: mocks.skillsSetEnabled,
    skillsDoctor: mocks.skillsDoctor,
  };
});

vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: mocks.openPath }));

import { SkillsPage } from "./SkillsPage";

const skill: SkillInfo = {
  id: "pdf-workbench",
  name: "pdf-workbench",
  title: "PDF Workbench",
  version: "1.0.0",
  summary: "Inspect, change and verify PDFs.",
  description: "Inspect, change and verify PDFs.",
  source: "builtin",
  enabled: true,
  directory: "C:\\skills\\pdf-workbench",
  triggers: ["pdf"],
  requires_tools: ["qpdf"],
  requires_python: ["pypdf"],
  requires_node: [],
};

const passed: SkillDoctorResult = {
  skill: "pdf-workbench",
  ok: true,
  missing: [],
  failed_tests: [],
  versions: { qpdf: "11.9.0" },
  detail: null,
};

describe("SkillsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.skillsList.mockResolvedValue([skill]);
    mocks.skillsSetEnabled.mockResolvedValue([{ ...skill, enabled: false }]);
    mocks.skillsDoctor.mockResolvedValue(passed);
  });

  afterEach(cleanup);

  it("lists a skill with its version and requirements", async () => {
    render(<SkillsPage />);
    expect(await screen.findByText("PDF Workbench")).toBeTruthy();
    expect(screen.getByText("1.0.0")).toBeTruthy();
    expect(screen.getByText("qpdf")).toBeTruthy();
  });

  it("disables a skill through the toggle", async () => {
    render(<SkillsPage />);
    fireEvent.click(await screen.findByRole("switch", { name: "Enable PDF Workbench" }));
    await waitFor(() =>
      expect(mocks.skillsSetEnabled).toHaveBeenCalledWith("pdf-workbench", false),
    );
  });

  it("shows the self-test result", async () => {
    render(<SkillsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /run self-test/i }));
    expect(await screen.findByText("Self-test passed")).toBeTruthy();
    expect(screen.getByText("qpdf 11.9.0")).toBeTruthy();
  });

  it("opens the skill folder", async () => {
    render(<SkillsPage />);
    fireEvent.click(await screen.findByRole("button", { name: /open folder/i }));
    await waitFor(() =>
      expect(mocks.openPath).toHaveBeenCalledWith("C:\\skills\\pdf-workbench"),
    );
  });
});
