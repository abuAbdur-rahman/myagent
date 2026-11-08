import { describe, expect, it } from "vitest";

import { splitVizSegments } from "./viz";

const html = '<div id="app"></div><script>document.getElementById("app").textContent = "hi"</script>';

describe("splitVizSegments", () => {
  it("turns a closed viz fence into a segment", () => {
    const segments = splitVizSegments(`Before\n\`\`\`viz\n${html}\n\`\`\`\nAfter`, false);
    expect(segments).toEqual([
      { kind: "text", text: "Before\n" },
      { kind: "viz", code: html, closed: true },
      { kind: "text", text: "\nAfter" },
    ]);
  });

  it("keeps the surrounding prose, so the visual is never the whole answer", () => {
    const segments = splitVizSegments(
      `Here is the comparison.\n\`\`\`viz\n${html}\n\`\`\`\nThe takeaway: MCP costs more context.`,
      false,
    );
    expect(segments.filter((segment) => segment.kind === "text")).toHaveLength(2);
  });

  it("marks an unclosed fence while streaming", () => {
    const segments = splitVizSegments(`Before\n\`\`\`viz\n${html}`, true);
    expect(segments[1]).toEqual({ kind: "viz", code: html, closed: false });
  });

  it("leaves an unclosed fence as text after streaming", () => {
    const content = `Before\n\`\`\`viz\n${html}`;
    expect(splitVizSegments(content, false)).toEqual([{ kind: "text", text: content }]);
  });

  it("accepts an indented fence and a longer fence", () => {
    const indented = splitVizSegments(`- item\n  \`\`\`viz\n${html}\n  \`\`\``, false);
    expect(indented[1]).toEqual({ kind: "viz", code: html, closed: true });
    const longer = splitVizSegments(`\`\`\`\`viz\n${html}\n\`\`\`\`\n`, false);
    expect(longer[0]).toEqual({ kind: "viz", code: html, closed: true });
  });

  it("does not extract a viz fence nested in another code block", () => {
    const content = "~~~\n```viz\n" + html + "\n```\n~~~";
    expect(splitVizSegments(content, false)).toEqual([{ kind: "text", text: content }]);
  });

  it("keeps ordinary code fences and other languages as text", () => {
    const content = "```ts\nconst answer = 42;\n```";
    expect(splitVizSegments(content, false)).toEqual([{ kind: "text", text: content }]);
  });
});
