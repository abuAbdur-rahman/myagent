import { describe, expect, it } from "vitest";

import {
  lookupSupportsTools,
  parseBackendCaps,
} from "./catalog";

describe("catalog smoke", () => {
  it("parses backend caps and gates tools on them", () => {
    const caps = parseBackendCaps([
      { id: "m1", supports_tools: true },
      { id: "m2", supports_tools: false },
    ]);
    expect(lookupSupportsTools(caps, "m1", "custom")).toBe(true);
    expect(lookupSupportsTools(caps, "m2", "custom")).toBe(false);
  });
});
