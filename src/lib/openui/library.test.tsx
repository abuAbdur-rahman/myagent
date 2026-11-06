// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Renderer } from "@openuidev/react-lang";
import { afterEach, describe, expect, it, vi } from "vitest";

import { openuiLibrary } from "./library";

afterEach(cleanup);

describe("openuiLibrary", () => {
  it("renders a small program with the app components", async () => {
    render(
      <Renderer
        library={openuiLibrary}
        response={'root = Stack([title])\ntitle = Text("Hello from OpenUI")'}
      />,
    );
    expect(await screen.findByText("Hello from OpenUI")).toBeTruthy();
  });

  it("renders a table from positional props", async () => {
    render(
      <Renderer
        library={openuiLibrary}
        response={
          'root = Stack([tbl])\ntbl = Table(["Region", "Revenue"], [["North", "$1.8M"], ["South", "$1.2M"]])'
        }
      />,
    );
    expect(await screen.findByText("North")).toBeTruthy();
    expect(await screen.findByText("$1.8M")).toBeTruthy();
  });

  it("accepts numeric stat and table values", async () => {
    render(
      <Renderer
        library={openuiLibrary}
        response={
          'root = Stack([card])\ncard = Card("Overview", [stat, tbl])\nstat = Stat("Revenue", 42)\ntbl = Table(["A", "B"], [["x", 1]])'
        }
      />,
    );
    expect(await screen.findByText("42")).toBeTruthy();
    expect(await screen.findByText("x")).toBeTruthy();
    expect(await screen.findByText("1")).toBeTruthy();
  });

  it("sends a button label when the button has no explicit action", async () => {
    const onAction = vi.fn();
    render(
      <Renderer
        library={openuiLibrary}
        response={'root = Stack([btn])\nbtn = Button("More")'}
        onAction={onAction}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "More" }));
    expect(onAction).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "continue_conversation",
        humanFriendlyMessage: "More",
      }),
    );
  });
});
