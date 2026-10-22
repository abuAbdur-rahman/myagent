import { describe, expect, it } from "vitest";

import { fenceForPaste, fencedBlock } from "./paste";

const TS_BLOCK = `function add(a: number, b: number) {
  return a + b;
}

const total = add(1, 2);
console.log(total);`;

const PY_BLOCK = `def greet(name):
    if not name:
        return "hi"
    return f"hello {name}"`;

describe("fenceForPaste", () => {
  it("wraps a pasted TypeScript block and tags it", () => {
    const result = fenceForPaste(TS_BLOCK);
    expect(result.wrapped).toBe(true);
    expect(result.language).toBe("ts");
  });

  it("recognises python by its keywords", () => {
    expect(fenceForPaste(PY_BLOCK)).toMatchObject({ wrapped: true, language: "python" });
  });

  it("leaves prose alone", () => {
    const prose = "The release went out on Tuesday.\nNobody reported a problem.";
    expect(fenceForPaste(prose).wrapped).toBe(false);
  });

  it("leaves a pasted markdown list alone", () => {
    const list = "- first item\n- second item\n- third item";
    expect(fenceForPaste(list).wrapped).toBe(false);
  });

  it("does not double-fence something already fenced", () => {
    expect(fenceForPaste("```ts\nconst a = 1;\n```").wrapped).toBe(false);
  });

  it("leaves a short single line alone", () => {
    expect(fenceForPaste("const a = 1;").wrapped).toBe(false);
  });

  it("leaves a short two-line value alone", () => {
    expect(fenceForPaste("a\nb").wrapped).toBe(false);
  });

  it("strips windows line endings before it decides", () => {
    const result = fenceForPaste(TS_BLOCK.replace(/\n/g, "\r\n"));
    expect(result.code).not.toContain("\r");
    expect(result.wrapped).toBe(true);
  });

  it("fences without a language when the block has no signal", () => {
    const result = fenceForPaste("alpha alpha alpha\n  beta beta beta\n      gamma gamma");
    expect(result.wrapped).toBe(true);
    expect(result.language).toBeNull();
  });
});

describe("fencedBlock", () => {
  it("builds a fence with the language on the first line", () => {
    expect(fencedBlock("const a = 1;", "js")).toBe("```js\nconst a = 1;\n```");
  });

  it("grows the fence when the code already contains three backticks", () => {
    expect(fencedBlock("```\ninner\n```", null)).toBe("````\n```\ninner\n```\n````");
  });
});
