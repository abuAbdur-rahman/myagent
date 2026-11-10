// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as api from "../lib/api";
import { ArtifactPreview } from "./ArtifactPreview";

vi.mock("../lib/api", () => ({
  artifactPreviewUrl: vi.fn(async () => ({
    id: "a1",
    url: "http://artifact.localhost/a/a1",
  })),
  artifactPreviewDrop: vi.fn(async () => undefined),
}));

const url = vi.mocked(api.artifactPreviewUrl);

afterEach(cleanup);

describe("ArtifactPreview", () => {
  it("renders a sandboxed frame that denies device capture", async () => {
    render(<ArtifactPreview code="<h1>x</h1>" onShowSource={() => {}} />);
    const frame = await screen.findByTitle("Artifact preview");

    expect(url).toHaveBeenCalledWith("<h1>x</h1>");
    expect(frame.getAttribute("src")).toBe("http://artifact.localhost/a/a1");
    expect(frame.getAttribute("sandbox")).toContain("allow-scripts");
    expect(frame.getAttribute("sandbox")).not.toContain("allow-same-origin");
    expect(frame.getAttribute("allow")).toBe(
      "camera 'none'; microphone 'none'; geolocation 'none'; display-capture 'none'",
    );
  });
});
