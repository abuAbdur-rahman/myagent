import { describe, expect, it } from "vitest";

import {
  knownModelVision,
  lookupSupportsTools,
  lookupVisionSupport,
  modelCanSeeImages,
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
    expect(lookupVisionSupport(caps, "sees")).toBe("yes");
    expect(lookupVisionSupport(caps, "blind")).toBe("no");
    expect(lookupVisionSupport(caps, "unknown")).toBe("unknown");
    expect(modelCanSeeImages(caps, "sees")).toBe(true);
    expect(modelCanSeeImages(caps, "blind")).toBe(false);
  });

  it("reads a known family when the provider reports no modality", () => {
    expect(knownModelVision("gpt-4o")).toBe("yes");
    expect(knownModelVision("anthropic/claude-sonnet-4")).toBe("yes");
    expect(knownModelVision("google/gemini-2.5-pro")).toBe("yes");
    expect(knownModelVision("qwen/qwen2.5-vl-72b-instruct")).toBe("yes");
    expect(knownModelVision("llama-3.2-vision-90b")).toBe("yes");
    expect(knownModelVision("gpt-4-turbo")).toBe("yes");
    expect(knownModelVision("deepseek-chat")).toBe("no");
    expect(knownModelVision("deepseek-reasoner")).toBe("no");
    expect(knownModelVision("meta-llama/llama-3.3-70b-instruct")).toBe("no");
    expect(knownModelVision("some-new-model")).toBe("unknown");
  });

  it("does not read a text-only sibling as a seeing family", () => {
    expect(knownModelVision("o3-mini")).toBe("no");
    expect(knownModelVision("o1-mini")).toBe("no");
    expect(knownModelVision("gpt-4")).toBe("no");
    expect(knownModelVision("gpt-4-0613")).toBe("no");
    expect(knownModelVision("gpt-3.5-turbo")).toBe("no");
    expect(knownModelVision("gemma-2-9b-it")).toBe("no");
    expect(knownModelVision("qwen2.5-72b-instruct")).toBe("no");
    expect(knownModelVision("o3")).toBe("yes");
    expect(knownModelVision("o4-mini")).toBe("unknown");
  });

  it("treats an unreported model as able to see, and lets an override decide", () => {
    const caps = parseBackendCaps([{ id: "unknown" }, { id: "blind", supports_vision: false }]);
    expect(modelCanSeeImages(caps, "unknown")).toBe(true);
    expect(modelCanSeeImages(null, "some-new-model")).toBe(true);
    expect(modelCanSeeImages(caps, "unknown", "no")).toBe(false);
    expect(modelCanSeeImages(caps, "blind", "yes")).toBe(true);
    expect(modelCanSeeImages(caps, "sees-nowhere", "no")).toBe(false);
  });
});
