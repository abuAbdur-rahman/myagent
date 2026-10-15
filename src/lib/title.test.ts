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

  it("strips a message that is only markup", () => {
    expect(deriveFallbackTitle("```js\nconst x = 1\n```")).toBe("New chat");
    expect(deriveFallbackTitle("###")).toBe("New chat");
  });

  it("caps the length without cutting a word", () => {
    const long = "Understand the implementation of the authentication flow deeply";
    const title = deriveFallbackTitle(long);
    expect(title.length).toBeLessThanOrEqual(48);
    expect(title.endsWith(" ")).toBe(false);
    expect(long.startsWith(title)).toBe(true);
  });
});
