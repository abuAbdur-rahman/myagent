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

  it("drops values that are not base64 image data", () => {
    expect(parseMessageAttachments('[{"dataUrl":"https://example.com/a.png"}]')).toEqual([]);
    expect(parseMessageAttachments('[{"dataUrl":"data:text/html;base64,AAA"}]')).toEqual([]);
    expect(parseMessageAttachments('[{"dataUrl":"data:image/svg+xml;base64,AAA"}]')).toEqual([]);
    expect(parseMessageAttachments('[{"dataUrl":"data:image/png,plain"}]')).toEqual([]);
    expect(parseMessageAttachments('[{"dataUrl":"javascript:alert(1)"}]')).toEqual([]);
  });

  it("keeps every supported image type", () => {
    const kept = ["png", "jpeg", "webp", "gif"].map((type) => ({
      dataUrl: `data:image/${type};base64,AAAA`,
    }));
    expect(parseMessageAttachments(JSON.stringify(kept))).toEqual(kept);
  });
});
