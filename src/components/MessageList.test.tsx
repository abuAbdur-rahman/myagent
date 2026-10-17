import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { MessageImages } from "./MessageList";
import type { Message } from "../lib/types";

const base: Message = {
  id: "m1",
  conversation_id: "c1",
  role: "user",
  content: "look",
  created_at: 1,
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
});
