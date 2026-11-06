import { describe, expect, it } from "vitest";

import { splitArtifactSegments } from "./artifacts";

const page = (title: string, heading: string) =>
  `<html><head><title>${title}</title></head><body><h1>${heading}</h1><p>${"x".repeat(60)}</p></body></html>`;

describe("artifact names", () => {
  it("uses the document title", () => {
    const [segment] = splitArtifactSegments("```html\n" + page("Revenue dashboard", "Q3") + "\n```");
    expect(segment.kind).toBe("artifact");
    if (segment.kind !== "artifact") return;
    expect(segment.artifact.title).toBe("Revenue dashboard");
  });

  it("prefers a title in the fence metadata", () => {
    const [segment] = splitArtifactSegments(
      '```html title="Board report"\n' + page("Ignored", "Q3") + "\n```",
    );
    if (segment.kind !== "artifact") throw new Error("expected artifact");
    expect(segment.artifact.title).toBe("Board report");
  });

  it("falls back to the first h1", () => {
    const [segment] = splitArtifactSegments(
      "```html\n" + page("", "Pipeline overview") + "\n```",
    );
    if (segment.kind !== "artifact") throw new Error("expected artifact");
    expect(segment.artifact.title).toBe("Pipeline overview");
  });

  it("falls back to a readable label", () => {
    const [segment] = splitArtifactSegments(
      "```html\n<html><body><p>" + "x".repeat(80) + "</p></body></html>\n```",
    );
    if (segment.kind !== "artifact") throw new Error("expected artifact");
    expect(segment.artifact.title).toBe("HTML preview");
  });

  it("does not treat html-template as an HTML artifact", () => {
    const segments = splitArtifactSegments(
      "```html-template\n" + page("Not an artifact", "Q3") + "\n```",
    );
    expect(segments).toHaveLength(1);
    expect(segments[0].kind).toBe("text");
  });

  it("does not add a second html extension", () => {
    const [segment] = splitArtifactSegments(
      "```html\n" + page("Report.html", "Q3") + "\n```",
    );
    if (segment.kind !== "artifact") throw new Error("expected artifact");
    expect(segment.artifact.title).toBe("Report");
  });

  it("dedupes repeated names", () => {
    const fence = "```html\n" + page("Same name", "Q3") + "\n```";
    const segments = splitArtifactSegments(`${fence}\n\n${fence}`);
    const names = segments
      .filter((segment) => segment.kind === "artifact")
      .map((segment) => (segment.kind === "artifact" ? segment.artifact.title : ""));
    expect(names).toEqual(["Same name", "Same name 2"]);
  });
});
