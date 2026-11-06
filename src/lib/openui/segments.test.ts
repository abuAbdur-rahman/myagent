import { describe, expect, it } from "vitest";

import { splitOpenUISegments } from "./segments";

const program = 'root = Stack([title])\ntitle = Text("Hello")';

describe("splitOpenUISegments", () => {
  it("turns a closed openui-lang fence into a UI segment", () => {
    const segments = splitOpenUISegments(`Before\n\`\`\`openui-lang\n${program}\n\`\`\`\nAfter`, false);
    expect(segments).toEqual([
      { kind: "text", text: "Before\n" },
      { kind: "openui", code: program, closed: true },
      { kind: "text", text: "\nAfter" },
    ]);
  });

  it("accepts the openui alias", () => {
    const segments = splitOpenUISegments(`\`\`\`openui\n${program}\n\`\`\``, false);
    expect(segments[0]).toEqual({ kind: "openui", code: program, closed: true });
  });

  it("renders an unclosed fence while streaming", () => {
    const segments = splitOpenUISegments(`Before\n\`\`\`openui-lang\n${program}`, true);
    expect(segments[1]).toEqual({ kind: "openui", code: program, closed: false });
  });

  it("leaves an unclosed fence as text after streaming", () => {
    const content = `Before\n\`\`\`openui-lang\n${program}`;
    expect(splitOpenUISegments(content, false)).toEqual([{ kind: "text", text: content }]);
  });

  it("accepts an indented fence", () => {
    const segments = splitOpenUISegments(`- item\n  \`\`\`openui-lang\n${program}\n  \`\`\``, false);
    expect(segments[1]).toEqual({ kind: "openui", code: program, closed: true });
  });

  it("keeps ordinary code fences in the text", () => {
    const content = `\`\`\`ts\nconst answer = 42;\n\`\`\``;
    expect(splitOpenUISegments(content, false)).toEqual([{ kind: "text", text: content }]);
  });

  it("handles two UI blocks and surrounding prose", () => {
    const segments = splitOpenUISegments(
      `one\n\`\`\`openui-lang\n${program}\n\`\`\`\ntwo\n\`\`\`openui-lang\n${program}\n\`\`\``,
      false,
    );
    expect(segments.filter((segment) => segment.kind === "openui")).toHaveLength(2);
    expect(segments[2]).toEqual({ kind: "text", text: "\ntwo\n" });
  });
});
