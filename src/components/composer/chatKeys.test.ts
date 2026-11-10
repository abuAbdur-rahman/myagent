import { describe, expect, it } from "vitest";

import { shouldSendOnEnter } from "./chatKeys";

const base = { inCodeBlock: false, popupOpen: false, sendOnEnter: true };

describe("shouldSendOnEnter", () => {
  it("sends when the composer is ready", () => {
    expect(shouldSendOnEnter(base)).toBe(true);
  });

  it("never sends inside a code block", () => {
    expect(shouldSendOnEnter({ ...base, inCodeBlock: true })).toBe(false);
  });

  it("defers while a popup is open", () => {
    expect(shouldSendOnEnter({ ...base, popupOpen: true })).toBe(false);
  });

  it("honours the send-on-Enter setting", () => {
    expect(shouldSendOnEnter({ ...base, sendOnEnter: false })).toBe(false);
  });
});
