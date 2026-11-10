// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { openArtifact, exportZip, save } = vi.hoisted(() => ({
  openArtifact: vi.fn(),
  exportZip: vi.fn(async () => 2),
  save: vi.fn(async () => "D:\\versions.zip"),
}));

const versions = [
  {
    id: "a1:tool:0",
    messageId: "a1",
    locator: { kind: "tool" as const, index: 0 },
    title: "Page.html",
    lang: "html",
    code: "<h1>one</h1>",
    index: 1,
    total: 2,
  },
  {
    id: "a2:tool:0",
    messageId: "a2",
    locator: { kind: "tool" as const, index: 0 },
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
    panelArtifact: versions[1],
    panelArtifactVersions: versions,
    panelTab: "preview",
    panelMode: "dock",
    panelView: "artifact",
    panelWidth: 480,
    setPanelTab: vi.fn(),
    setPanelMode: vi.fn(),
    setPanelWidth: vi.fn(),
    showSessionView: vi.fn(),
    closePanel: vi.fn(),
    openArtifact,
  }),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({ save }));
vi.mock("../lib/api", () => ({ artifactZipExport: exportZip }));
vi.mock("./ArtifactPreview", () => ({ ArtifactPreview: () => <div>Preview</div> }));

import { ArtifactsPanel } from "./ArtifactsPanel";

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

    expect(openArtifact).toHaveBeenCalledWith(versions[0]);
  });

  it("exports every version as a named zip entry", async () => {
    render(<ArtifactsPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Download all artifact versions" }));

    await waitFor(() =>
      expect(exportZip).toHaveBeenCalledWith("D:\\versions.zip", [
        { name: "01-Page.html", content: "<h1>one</h1>" },
        { name: "02-Page.html", content: "<h1>two</h1>" },
      ]),
    );
  });
});
