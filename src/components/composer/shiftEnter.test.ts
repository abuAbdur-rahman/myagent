import { describe, expect, it } from "vitest";
import { fenceLanguage, shiftEnterAction, type ShiftEnterContext } from "./shiftEnter";

function context(overrides: Partial<ShiftEnterContext> = {}): ShiftEnterContext {
  const textContent = overrides.textContent ?? "";
  return {
    parentType: "paragraph",
    depth: 1,
    textContent,
    atParentEnd: true,
    inListItem: false,
    listItemEmpty: textContent.length === 0,
    ...overrides,
  };
}

describe("fenceLanguage", () => {
  it("returns the language for a bare fence line", () => {
    expect(fenceLanguage("```ts")).toBe("ts");
    expect(fenceLanguage("```")).toBe("");
    expect(fenceLanguage("```c++")).toBe("c++");
  });

  it("ignores fences that share a line with other text", () => {
    expect(fenceLanguage("hi```")).toBeNull();
    expect(fenceLanguage("text ```ts")).toBeNull();
    expect(fenceLanguage("```ts extra")).toBeNull();
  });
});

describe("shiftEnterAction", () => {
  it("starts a code block from a single-line fence", () => {
    expect(shiftEnterAction(context({ textContent: "```ts" }))).toEqual({
      kind: "codeBlock",
      language: "ts",
    });
  });

  it("does not start a code block when the fence is not alone on its line", () => {
    expect(shiftEnterAction(context({ textContent: "hi\n```ts" }))).toEqual({ kind: "splitBlock" });
  });

  it("leaves the caret line as a real block so block markdown rules can match", () => {
    expect(shiftEnterAction(context({ textContent: "hi" }))).toEqual({ kind: "splitBlock" });
  });

  it("keeps newlines inside a code block", () => {
    expect(shiftEnterAction(context({ parentType: "codeBlock", textContent: "x" }))).toEqual({
      kind: "insertNewline",
    });
  });

  it("continues or exits a list item", () => {
    expect(shiftEnterAction(context({ inListItem: true }))).toEqual({ kind: "liftListItem" });
    expect(shiftEnterAction(context({ inListItem: true, textContent: "item" }))).toEqual({
      kind: "splitListItem",
    });
  });

  it("splits the block inside a container such as a quote", () => {
    expect(shiftEnterAction(context({ depth: 2, textContent: "quoted" }))).toEqual({
      kind: "splitBlock",
    });
  });
});
