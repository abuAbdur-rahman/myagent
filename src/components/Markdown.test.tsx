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
});
