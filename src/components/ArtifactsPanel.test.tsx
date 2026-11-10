// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Version = {
  id: string;
  messageId: string;
  locator: { kind: "tool" | "fence"; index: number };
  title: string;
  lang: string;
  code: string;
  index: number;
  total: number;
};

const h = vi.hoisted(() => ({
  openArtifact: vi.fn(),
  exportZip: vi.fn(async () => 2),
  save: vi.fn(async () => "D:\\versions.zip"),
  toast: vi.fn(),
  state: { versions: [] as unknown[] },
}));

const versions: Version[] = [
  {
    id: "a1:tool:0",
    messageId: "a1",
    locator: { kind: "tool", index: 0 },
    title: "Page.html",
    lang: "html",
    code: "<h1>one</h1>",
    index: 1,
    total: 2,
  },
  {
    id: "a2:tool:0",
    messageId: "a2",
    locator: { kind: "tool", index: 0 },
    title: "Page.html",
    lang: "html",
    code: "<h1>two</h1>",
    index: 2,
    total: 2,
  },
];

vi.mock("../lib/store", () => ({
  useApp: () => ({
    panelOpen: true,
    panelArtifact: (h.state.versions as Version[])[1],
    panelArtifactVersions: h.state.versions,
    panelTab: "preview",
    panelMode: "dock",
    panelView: "artifact",
    panelWidth: 480,
    setPanelTab: vi.fn(),
    setPanelMode: vi.fn(),
    setPanelWidth: vi.fn(),
    showSessionView: vi.fn(),
    closePanel: vi.fn(),
    openArtifact: h.openArtifact,
  }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: h.save }));
vi.mock("../lib/api", () => ({ artifactZipExport: h.exportZip }));
vi.mock("../lib/toast", () => ({ toast: h.toast }));
vi.mock("./ArtifactPreview", () => ({ ArtifactPreview: () => <div>Preview</div> }));

import { ArtifactsPanel } from "./ArtifactsPanel";

beforeEach(() => {
  h.state.versions = versions;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ArtifactsPanel versions", () => {
  it("switches between regeneration versions", () => {
    render(<ArtifactsPanel />);

    fireEvent.change(screen.getByRole("combobox", { name: "Artifact version" }), {
      target: { value: "a1:tool:0" },
    });

    expect(h.openArtifact).toHaveBeenCalledWith(versions[0]);
  });

  it("exports every version as a named zip entry", async () => {
    render(<ArtifactsPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Download all artifact versions" }));

    await waitFor(() =>
      expect(h.exportZip).toHaveBeenCalledWith("D:\\versions.zip", [
        { name: "01-Page.html", content: "<h1>one</h1>" },
        { name: "02-Page.html", content: "<h1>two</h1>" },
      ]),
    );
  });

  it("refuses a history the backend cannot zip before asking for a path", () => {
    h.state.versions = [
      { ...versions[0], code: "x".repeat(2 * 1024 * 1024 + 1) },
      versions[1],
    ];
    render(<ArtifactsPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Download all artifact versions" }));

    expect(h.save).not.toHaveBeenCalled();
    expect(h.toast).toHaveBeenCalledWith(expect.stringContaining("2 MB"));
  });
});
