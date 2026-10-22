import { describe, expect, it } from "vitest";

import {
  buildModelRow,
  contextLabel,
  countHidden,
  effectiveVision,
  filterModelRows,
  visionLabel,
} from "./model-table";
import type { ModelCapabilities } from "./catalog";

const CAPS: ModelCapabilities[] = [
  {
    id: "deepseek-chat",
    contextLength: 128_000,
    supportsTools: true,
    supportsVision: false,
    reasoningEfforts: null,
    reasoningMandatory: false,
  },
  {
    id: "mystery-model",
    contextLength: null,
    supportsTools: null,
    supportsVision: null,
    reasoningEfforts: null,
    reasoningMandatory: false,
  },
];

const row = (modelId: string, override: "yes" | "no" | null = null) =>
  buildModelRow({
    connectionId: "c1",
    connectionName: "DeepSeek",
    kind: "deepseek",
    modelId,
    caps: CAPS,
    hidden: false,
    override,
  });

describe("contextLabel", () => {
  it("prints a known window in k", () => {
    expect(contextLabel(128_000)).toBe("128k");
  });

  it("prints millions when the window is that large", () => {
    expect(contextLabel(1_000_000)).toBe("1M");
    expect(contextLabel(2_000_000)).toBe("2M");
  });

  it("says unknown when the provider never reported one", () => {
    expect(contextLabel(null)).toBe("Unknown");
  });
});

describe("effectiveVision", () => {
  it("keeps an absent capability unknown", () => {
    expect(effectiveVision(CAPS, "mystery-model", null)).toBe("unknown");
    expect(visionLabel("unknown")).toBe("Unknown");
  });

  it("lets an override win over the catalog", () => {
    expect(effectiveVision(CAPS, "deepseek-chat", "yes")).toBe("yes");
    expect(effectiveVision(CAPS, "mystery-model", "no")).toBe("no");
  });

  it("reads the catalog when there is no override", () => {
    expect(effectiveVision(CAPS, "deepseek-chat", null)).toBe("no");
  });
});

describe("buildModelRow", () => {
  it("carries the reported context and tool decision", () => {
    const built = row("deepseek-chat");
    expect(built.context).toBe(128_000);
    expect(built.tools).toBe(true);
    expect(built.override).toBeNull();
  });

  it("leaves unknown context and vision as null and unknown", () => {
    const built = row("mystery-model");
    expect(built.context).toBeNull();
    expect(built.vision).toBe("unknown");
  });

  it("gives every row a key that cannot collide across providers", () => {
    expect(row("deepseek-chat").key).toBe("c1::deepseek-chat");
  });
});

describe("filterModelRows", () => {
  const rows = [row("deepseek-chat"), row("mystery-model")];

  it("narrows to a substring, case insensitively", () => {
    expect(filterModelRows(rows, "MYSTERY").map((r) => r.modelId)).toEqual(["mystery-model"]);
  });

  it("keeps every row for an empty query", () => {
    expect(filterModelRows(rows, "  ")).toHaveLength(2);
  });

  it("counts hidden rows for the header", () => {
    expect(countHidden([{ ...rows[0], hidden: true }, rows[1]])).toBe(1);
  });
});
