import { describe, expect, it } from "vitest";

import { stripActiveContent } from "./thumb";

describe("stripActiveContent", () => {
  it("removes an inline script with its body", () => {
    const html = "<div>hi</div><script>alert(1)</script>";
    const clean = stripActiveContent(html);
    expect(clean).toBe("<div>hi</div>");
    expect(clean).not.toContain("alert");
  });

  it("removes a script tag with attributes and a source", () => {
    const clean = stripActiveContent('<script src="x.js"></script><p>ok</p>');
    expect(clean).not.toContain("<script");
    expect(clean).toContain("<p>ok</p>");
  });

  it("removes inline event handlers in either quoting style", () => {
    const clean = stripActiveContent(
      '<a href="#" onclick="x()">a</a><b onmouseover=\'y()\'>b</b>',
    );
    expect(clean).not.toContain("onclick");
    expect(clean).not.toContain("onmouseover");
    expect(clean).toContain("<a href=\"#\">a</a>");
  });

  it("removes a javascript: url", () => {
    expect(stripActiveContent('<a href="javascript:alert(1)">a</a>')).not.toContain(
      "javascript:",
    );
  });

  it("leaves a plain page untouched", () => {
    const html = "<h1>Report</h1><p>Text</p>";
    expect(stripActiveContent(html)).toBe(html);
  });
});
