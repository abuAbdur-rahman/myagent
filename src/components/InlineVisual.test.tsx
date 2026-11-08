// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as api from "../lib/api";
import { InlineVisual } from "./InlineVisual";

vi.mock("../lib/api", () => ({
  artifactInlineUrl: vi.fn(async () => ({
    id: "v1",
    url: "http://artifact.localhost/i/v1",
  })),
  artifactPreviewDrop: vi.fn(async () => undefined),
}));

const inline = vi.mocked(api.artifactInlineUrl);

describe("InlineVisual", () => {
  beforeEach(() => {
    inline.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows a building state while the fence is open", () => {
    render(<InlineVisual code="<h1>x</h1>" isStreaming />);
    expect(screen.getByRole("status").textContent).toContain("Building");
    expect(inline).not.toHaveBeenCalled();
  });

  it("renders a sandboxed frame from the inline route", async () => {
    render(<InlineVisual code="<h1>x</h1>" isStreaming={false} />);
    const frame = await screen.findByTitle("Interactive visual");
    expect(frame.getAttribute("src")).toBe("http://artifact.localhost/i/v1");
    expect(frame.getAttribute("sandbox")).toContain("allow-scripts");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
  });
});
