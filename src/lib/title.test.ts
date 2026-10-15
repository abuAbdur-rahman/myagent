import { describe, expect, it } from "vitest";

import { deriveFallbackTitle } from "./title";

describe("deriveFallbackTitle", () => {
  it("takes the first few words of a plain message", () => {
    expect(deriveFallbackTitle("Explain how closures work in JavaScript")).toBe(
      "Explain how closures work in JavaScript",
    );
  });

  it("strips markdown and code fences", () => {
    expect(deriveFallbackTitle("# Heading\n```js\nconst x = 1\n```\nreal question here")).toBe(
      "Heading real question here",
    );
  });

  it("tolerates empty and whitespace input", () => {
    expect(deriveFallbackTitle("   ")).toBe("New chat");
    expect(deriveFallbackTitle("")).toBe("New chat");
  });

  it("caps the length", () => {
    const long = "word ".repeat(40);
    expect(deriveFallbackTitle(long).length).toBeLessThanOrEqual(48);
  });
});
