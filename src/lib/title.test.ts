import { describe, expect, it } from "vitest";

import { deriveFallbackTitle, plainTitle } from "./title";

describe("plainTitle", () => {
  it("drops bold markers from a generated title", () => {
    expect(plainTitle("**Memory Management** - notes")).toBe("Memory Management - notes");
  });

  it("drops headings, backticks and wrapping quotes", () => {
    expect(plainTitle("## Local models")).toBe("Local models");
    expect(plainTitle("`agent` setup")).toBe("agent setup");
    expect(plainTitle("\"DeepSeek setup.\"")).toBe("DeepSeek setup");
  });

  it("leaves a plain title alone and keeps underscores inside words", () => {
    expect(plainTitle("Agent Router")).toBe("Agent Router");
    expect(plainTitle("my_agent setup")).toBe("my_agent setup");
  });
});

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
