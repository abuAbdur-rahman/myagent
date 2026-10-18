import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { MessageDocuments, MessageImages } from "./MessageList";
import type { Message } from "../lib/types";

const base: Message = {
  id: "m1",
  conversation_id: "c1",
  role: "user",
  content: "look",
  created_at: 1,
};

const DOC = {
  kind: "doc" as const,
  name: "report.pdf",
  mime: "application/pdf",
  sha256: "a".repeat(64),
  size: 2048,
  chars: 4096,
};

describe("MessageImages", () => {
  it("renders one image per stored attachment", () => {
    const attachments = JSON.stringify([
      { dataUrl: "data:image/png;base64,AAA" },
      { dataUrl: "data:image/png;base64,BBB" },
    ]);
    const html = renderToStaticMarkup(
      <MessageImages message={{ ...base, attachments }} />,
    );
    expect(html.match(/<img/g)).toHaveLength(2);
    expect(html).toContain('src="data:image/png;base64,AAA"');
    expect(html).toContain('alt="Attached image 1"');
  });

  it("renders nothing when the message has no images", () => {
    expect(renderToStaticMarkup(<MessageImages message={base} />)).toBe("");
    expect(
      renderToStaticMarkup(<MessageImages message={{ ...base, attachments: "[]" }} />),
    ).toBe("");
  });

  it("ignores document references", () => {
    const attachments = JSON.stringify([DOC]);
    expect(
      renderToStaticMarkup(<MessageImages message={{ ...base, attachments }} />),
    ).toBe("");
  });
});

describe("MessageDocuments", () => {
  it("names each attached document with its size", () => {
    const attachments = JSON.stringify([DOC]);
    const html = renderToStaticMarkup(
      <MessageDocuments message={{ ...base, attachments }} />,
    );
    expect(html).toContain("report.pdf");
    expect(html).toContain("4,096 chars");
    expect(html).not.toContain("<img");
  });

  it("renders nothing for images, empty, or missing attachments", () => {
    const images = JSON.stringify([{ dataUrl: "data:image/png;base64,AAA" }]);
    expect(
      renderToStaticMarkup(<MessageDocuments message={{ ...base, attachments: images }} />),
    ).toBe("");
    expect(renderToStaticMarkup(<MessageDocuments message={base} />)).toBe("");
    expect(
      renderToStaticMarkup(<MessageDocuments message={{ ...base, attachments: "[]" }} />),
    ).toBe("");
  });
});
