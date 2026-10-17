import { describe, expect, it } from "vitest";

import { parseMessageAttachments } from "./attachments";

describe("parseMessageAttachments", () => {
  it("returns the stored images", () => {
    const stored = JSON.stringify([{ dataUrl: "data:image/png;base64,AAA" }]);
    expect(parseMessageAttachments(stored)).toEqual([
      { dataUrl: "data:image/png;base64,AAA" },
    ]);
  });

  it("returns nothing for absent, empty, or malformed values", () => {
    expect(parseMessageAttachments(null)).toEqual([]);
    expect(parseMessageAttachments(undefined)).toEqual([]);
    expect(parseMessageAttachments("")).toEqual([]);
    expect(parseMessageAttachments("[{}]")).toEqual([]);
    expect(parseMessageAttachments('{"dataUrl":"x"}')).toEqual([]);
    expect(parseMessageAttachments("{ not json")).toEqual([]);
    expect(parseMessageAttachments([{ dataUrl: "x" }])).toEqual([]);
  });
});
