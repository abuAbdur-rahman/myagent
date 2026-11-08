import { describe, expect, it } from "vitest";
import { speechText } from "./read-aloud";

describe("speechText", () => {
  it("strips markdown emphasis and headings", () => {
    expect(speechText("## Title\n**bold** and _italic_")).toBe("Title bold and italic");
  });

  it("drops fenced code but keeps inline code", () => {
    expect(speechText("Use `npm test`.\n\n```ts\nconst a = 1;\n```")).toBe("Use npm test.");
  });

  it("keeps link text and drops images", () => {
    expect(speechText("See [docs](https://x.test) ![alt](a.png)")).toBe("See docs");
  });

  it("removes list markers and collapses whitespace", () => {
    expect(speechText("- one\n- two\n\n  three")).toBe("one two three");
  });
});
