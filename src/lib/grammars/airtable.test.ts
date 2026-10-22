import { describe, expect, it } from "vitest";
import { createHighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import githubDark from "shiki/themes/github-dark.mjs";

import airtableGrammar from "./airtable.tmLanguage.json";

describe("airtable grammar", () => {
  it("loads in the same engine the composer uses and colours a formula", async () => {
    const highlighter = await createHighlighterCore({
      themes: [githubDark],
      langs: [airtableGrammar],
      engine: createJavaScriptRegexEngine(),
    });

    expect(highlighter.getLoadedLanguages()).toContain("airtable");

    const html = highlighter.codeToHtml('IF({Due date} < "2026-01-01", 1, 0)', {
      lang: "airtable",
      theme: "github-dark",
    });

    expect(html).toContain("{Due date}");
    expect(html).toMatch(/color:#/);
    expect(html).not.toBe(
      highlighter.codeToHtml('IF({Due date} < "2026-01-01", 1, 0)', {
        lang: "text",
        theme: "github-dark",
      }),
    );
  });
});
