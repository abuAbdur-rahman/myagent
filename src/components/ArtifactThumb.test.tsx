// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ArtifactThumb } from "./ArtifactThumb";

afterEach(cleanup);

describe("ArtifactThumb", () => {
  it("keeps the HTML thumbnail fully sandboxed and denies device capture", () => {
    const { container } = render(
      <ArtifactThumb artifact={{ title: "Page", lang: "html", code: "<h1>x</h1>" }} />,
    );
    const frame = container.querySelector("iframe");
    expect(frame?.getAttribute("sandbox")).toBe("");
    expect(frame?.getAttribute("allow")).toBe(
      "camera 'none'; microphone 'none'; geolocation 'none'; display-capture 'none'",
    );
  });
});
