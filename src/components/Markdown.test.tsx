// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Markdown } from "./Markdown";

afterEach(cleanup);

describe("Markdown code blocks", () => {
  it("gives an unlabelled fence the same header, copy button and frame", async () => {
    render(<Markdown content={"```\nplain words\n```"} />);
    expect(await screen.findByText("text")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
    expect(document.querySelector(".codeblock")).not.toBeNull();
    expect(document.querySelector(".codeblock-body")).not.toBeNull();
  });

  it("labels an unknown language instead of leaving it plain", async () => {
    render(<Markdown content={"```text\nplain words\n```"} />);
    expect(await screen.findByText("text")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
  });

  it("keeps known languages in the same frame", async () => {
    render(<Markdown content={"```ts\nconst answer = 42;\n```"} />);
    expect(await screen.findByText("ts")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
    expect(document.querySelector(".codeblock")).not.toBeNull();
  });

  it("extracts the language token before a fence attribute", async () => {
    render(<Markdown content={"```ts title=x\nconst answer = 42;\n```"} />);
    expect(await screen.findByText("ts")).toBeTruthy();
    expect(document.querySelector(".codeblock")).not.toBeNull();
  });

  it("wraps a pre element with a non-language class", async () => {
    render(<Markdown content={'<pre><code class="example">plain</code></pre>'} />);
    expect(await screen.findByText("text")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Copy" })).toBeTruthy();
    expect(document.querySelector(".codeblock")).not.toBeNull();
  });

  it("renders a markdown fence as prose instead of code", async () => {
    render(<Markdown content={"```md\n## Milestone 1\n\n**Outcome**\n```"} />);
    expect(await screen.findByRole("heading", { level: 2, name: "Milestone 1" })).toBeTruthy();
    expect(document.querySelector(".md-fence")).not.toBeNull();
    expect(document.querySelector(".codeblock")).toBeNull();
  });

  it("renders a txt fence that contains markdown as prose", async () => {
    render(<Markdown content={"```txt\n## Milestone 2\n\n- one\n- two\n```"} />);
    expect(await screen.findByRole("heading", { level: 2, name: "Milestone 2" })).toBeTruthy();
    expect(document.querySelector(".md-fence")).not.toBeNull();
  });

  it("keeps plain text fences as code", async () => {
    render(<Markdown content={"```txt\nplain words only\n```"} />);
    expect(await screen.findByText("txt")).toBeTruthy();
    expect(document.querySelector(".codeblock")).not.toBeNull();
  });
});

describe("Markdown math and diagrams", () => {
  it("renders inline math with KaTeX", () => {
    render(<Markdown content={"$x^2$"} />);
    expect(document.querySelector(".katex")).not.toBeNull();
  });

  it("reserves a mermaid block and keeps its source", () => {
    render(<Markdown content={"```mermaid\ngraph TD; A-->B;\n```"} />);
    const node = document.querySelector(".mermaid-src");
    expect(node).not.toBeNull();
    expect(node?.getAttribute("data-src")).toContain("graph");
  });
});
