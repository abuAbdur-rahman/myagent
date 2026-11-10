// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { TipTapEditor, type TipTapHandle } from "./TipTapEditor";
import type { ChatKeyCallbacks } from "./chatKeys";

function callbacks(overrides: Partial<ChatKeyCallbacks> = {}): ChatKeyCallbacks {
  return {
    send: () => {},
    onEscape: () => false,
    isPopupOpen: () => false,
    sendOnEnter: () => true,
    historyEntries: () => [],
    ...overrides,
  };
}

function setup(chat: ChatKeyCallbacks | null, initialMarkdown = "") {
  const handle = createRef<TipTapHandle>();
  const view = render(
    <TipTapEditor
      placeholder="Ask anything"
      signal={null}
      initialMarkdown={initialMarkdown}
      handleRef={handle}
      onChangeMarkdown={() => {}}
      chat={chat}
    />,
  );
  return { handle, view };
}

beforeAll(() => {
  const rect = () =>
    ({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      toJSON: () => ({}),
    }) as unknown as DOMRect;
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: rect,
  });
  Object.defineProperty(Range.prototype, "getClientRects", {
    configurable: true,
    value: () =>
      ({
        length: 0,
        item: () => null,
        [Symbol.iterator]: [][Symbol.iterator],
      }) as unknown as DOMRectList,
  });
});

afterEach(cleanup);

describe("composer acceptance", () => {
  it("serializes rich text as markdown and clears on request", async () => {
    const { handle } = setup(null);
    await waitFor(() => expect(handle.current).not.toBeNull());

    act(() => handle.current?.setMarkdown("**bold** and `code`"));
    const markdown = handle.current?.getMarkdown() ?? "";
    expect(markdown).toContain("**bold**");
    expect(markdown).toContain("`code`");

    act(() => handle.current?.clear());
    expect(handle.current?.getMarkdown().trim()).toBe("");
  });

  it("sends on Enter outside a code block", async () => {
    const send = vi.fn();
    const { handle, view } = setup(callbacks({ send }));
    await waitFor(() => expect(handle.current).not.toBeNull());

    const dom = view.container.querySelector(".composer-editor");
    expect(dom).not.toBeNull();

    fireEvent.keyDown(dom as Element, { key: "Enter" });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("walks history with ArrowUp at the start and ArrowDown at the end", async () => {
    const history = ["older note"];
    const { handle, view } = setup(callbacks({ historyEntries: () => history }));
    await waitFor(() => expect(handle.current).not.toBeNull());

    const dom = view.container.querySelector(".composer-editor") as Element;
    fireEvent.keyDown(dom, { key: "ArrowUp" });
    await waitFor(() => expect(handle.current?.getMarkdown()).toContain("older note"));

    act(() => handle.current?.focus("end"));
    fireEvent.keyDown(dom, { key: "ArrowDown" });
    await waitFor(() => expect(handle.current?.getMarkdown().trim()).toBe(""));
  });
});
