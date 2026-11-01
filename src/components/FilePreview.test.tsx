// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  artifactPreview: vi.fn(),
  openPath: vi.fn(),
}));

vi.mock("../lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/api")>();
  return { ...actual, artifactPreview: mocks.artifactPreview };
});

vi.mock("@tauri-apps/plugin-opener", () => ({ openPath: mocks.openPath }));

import { FilePreview } from "./FilePreview";

describe("FilePreview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.artifactPreview.mockResolvedValue({
      absolute: "C:\\work\\outputs\\deck.pptx",
      images: ["data:image/png;base64,AAAA"],
      text: "Slide one",
    });
  });

  afterEach(cleanup);

  it("shows converted pages and extracted text", async () => {
    render(<FilePreview path="outputs/deck.pptx" />);
    expect(await screen.findByAltText("Page 1")).toBeTruthy();
    expect(screen.getByText("Slide one")).toBeTruthy();
    expect(mocks.artifactPreview).toHaveBeenCalledWith("outputs/deck.pptx");
  });

  it("opens the original file", async () => {
    render(<FilePreview path="outputs/deck.pptx" />);
    fireEvent.click(await screen.findByRole("button", { name: /open file/i }));
    await waitFor(() =>
      expect(mocks.openPath).toHaveBeenCalledWith("C:\\work\\outputs\\deck.pptx"),
    );
  });

  it("explains when conversion needs the sandbox", async () => {
    mocks.artifactPreview.mockRejectedValue("Enable the sandbox to preview this file");
    render(<FilePreview path="outputs/deck.pptx" />);
    expect(await screen.findByText(/Enable the sandbox to preview this file/i)).toBeTruthy();
  });
});
