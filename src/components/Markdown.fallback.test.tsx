// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("shiki/core", () => ({
  createHighlighterCore: () => new Promise(() => undefined),
}));

import { Markdown } from "./Markdown";

afterEach(cleanup);

describe("Markdown without a highlighter", () => {
  it("still renders the code-block header and Copy", () => {
    render(<Markdown content={"```ts\nconst answer = 42;\n```"} />);
    expect(screen.getByText("ts")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
    expect(document.querySelector(".codeblock")).not.toBeNull();
    expect(document.querySelector(".codeblock-body")).not.toBeNull();
  });
});
