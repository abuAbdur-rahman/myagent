import { describe, expect, it } from "vitest";

import { nextFocusIndex } from "./focus-trap";

describe("nextFocusIndex", () => {
  it("moves forward and wraps at the end", () => {
    expect(nextFocusIndex(0, 3, false)).toBe(1);
    expect(nextFocusIndex(2, 3, false)).toBe(0);
  });

  it("moves backward and wraps at the start", () => {
    expect(nextFocusIndex(1, 3, true)).toBe(0);
    expect(nextFocusIndex(0, 3, true)).toBe(2);
  });

  it("enters at the first control going forward", () => {
    expect(nextFocusIndex(-1, 3, false)).toBe(0);
  });

  it("enters at the last control going backward", () => {
    expect(nextFocusIndex(-1, 3, true)).toBe(2);
  });

  it("has nowhere to go in an empty dialog", () => {
    expect(nextFocusIndex(0, 0, false)).toBe(-1);
    expect(nextFocusIndex(-1, 0, true)).toBe(-1);
  });
});
