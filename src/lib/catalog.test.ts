import { describe, expect, it } from "vitest";

import {
  lookupSupportsTools,
  lookupSupportsVision,
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

  it("parses vision flags and gates image input on them", () => {
    const caps = parseBackendCaps([
      { id: "sees", supports_vision: true },
      { id: "blind", supports_vision: false },
      { id: "unknown" },
    ]);
    expect(lookupSupportsVision(caps, "sees")).toBe(true);
    expect(lookupSupportsVision(caps, "blind")).toBe(false);
    expect(lookupSupportsVision(caps, "unknown")).toBe(false);
    expect(lookupSupportsVision(null, "sees")).toBe(false);
  });
});
