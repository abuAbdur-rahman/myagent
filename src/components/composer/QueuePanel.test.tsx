// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { QueuePanel } from "./QueuePanel";

const items = [
  { id: "a", text: "First queued message" },
  { id: "b", text: "Second queued message" },
];

function renderPanel(overrides: Partial<Parameters<typeof QueuePanel>[0]> = {}) {
  const props = {
    items,
    collapsed: false,
    onToggle: vi.fn(),
    onEdit: vi.fn(),
    onSend: vi.fn(),
    onRemove: vi.fn(),
    onMove: vi.fn(),
    ...overrides,
  };
  render(<QueuePanel {...props} />);
  return props;
}

describe("QueuePanel", () => {
  afterEach(() => cleanup());

  it("shows the count and every queued preview", () => {
    renderPanel();
    expect(screen.getByText("Queued messages")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.getByText("First queued message")).toBeTruthy();
  });

  it("hides rows when collapsed", () => {
    renderPanel({ collapsed: true });
    expect(screen.queryByText("First queued message")).toBeNull();
    expect(
      screen.getByRole("button", { name: /queued messages/i }).getAttribute("aria-expanded"),
    ).toBe("false");
  });

  it("routes edit, send and remove", () => {
    const props = renderPanel();
    fireEvent.click(screen.getAllByRole("button", { name: "Edit queued message" })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: "Send queued message next" })[1]);
    fireEvent.click(screen.getAllByRole("button", { name: "Remove queued message" })[0]);
    expect(props.onEdit).toHaveBeenCalledWith("a");
    expect(props.onSend).toHaveBeenCalledWith("b");
    expect(props.onRemove).toHaveBeenCalledWith("a");
  });

  it("renders nothing for an empty queue", () => {
    const { container } = render(
      <QueuePanel
        items={[]}
        collapsed={false}
        onToggle={vi.fn()}
        onEdit={vi.fn()}
        onSend={vi.fn()}
        onRemove={vi.fn()}
        onMove={vi.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });
});
