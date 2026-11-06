// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { Renderer } from "@openuidev/react-lang";
import { afterEach, describe, expect, it } from "vitest";

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
});
