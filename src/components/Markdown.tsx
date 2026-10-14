import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { openUrl } from "@tauri-apps/plugin-opener";
import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import githubDark from "shiki/themes/github-dark.mjs";
import typescript from "shiki/langs/typescript.mjs";
import tsx from "shiki/langs/tsx.mjs";
import javascript from "shiki/langs/javascript.mjs";
import jsx from "shiki/langs/jsx.mjs";
import json from "shiki/langs/json.mjs";
import python from "shiki/langs/python.mjs";
import bash from "shiki/langs/bash.mjs";
import htmlLang from "shiki/langs/html.mjs";
import css from "shiki/langs/css.mjs";
import sql from "shiki/langs/sql.mjs";
import yaml from "shiki/langs/yaml.mjs";
import java from "shiki/langs/java.mjs";
import c from "shiki/langs/c.mjs";
import cpp from "shiki/langs/cpp.mjs";
import markdownLang from "shiki/langs/markdown.mjs";
import { copyText } from "../lib/utils";
import { toast } from "../lib/toast";

const ALIASES: Record<string, string> = {
  ts: "typescript",
  typescript: "typescript",
  js: "javascript",
  javascript: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  tsx: "tsx",
  jsx: "jsx",
  py: "python",
  python: "python",
  sh: "bash",
  shell: "bash",
  shellscript: "bash",
  zsh: "bash",
  bash: "bash",
  md: "markdown",
  markdown: "markdown",
  yml: "yaml",
  yaml: "yaml",
  "c++": "cpp",
  cpp: "cpp",
  c: "c",
  html: "html",
  css: "css",
  json: "json",
  sql: "sql",
  java: "java",
};

let highlighterPromise: Promise<HighlighterCore> | null = null;

function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [githubDark],
      langs: [
        typescript,
        tsx,
        javascript,
        jsx,
        json,
        python,
        bash,
        htmlLang,
        css,
        sql,
        yaml,
        java,
        c,
        cpp,
        markdownLang,
      ],
      engine: createJavaScriptRegexEngine(),
    });
  }
  return highlighterPromise;
}

function unescapeMarked(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function renderHtml(content: string, highlighter: HighlighterCore | null): string {
  const raw = marked.parse(content, { async: false, breaks: true }) as string;
  let html = DOMPurify.sanitize(raw);
  if (!highlighter) return html;

  html = html.replace(
    /<pre><code class="language-([\w+-]+)">([\s\S]*?)<\/code><\/pre>/g,
    (match, fence: string, escaped: string) => {
      const lang = ALIASES[String(fence).toLowerCase()];
      if (!lang || !highlighter.getLoadedLanguages().includes(lang)) return match;
      const code = unescapeMarked(escaped).replace(/\n$/, "");
      const highlighted = highlighter.codeToHtml(code, { lang, theme: "github-dark" });
      const header =
        `<div class="codeblock-head"><span>${lang}</span>` +
        `<button type="button" data-copy-code="1">Copy</button></div>`;
      return `<div class="codeblock">${header}${highlighted}</div>`;
    },
  );
  return DOMPurify.sanitize(html);
}

export function Markdown({ content }: { content: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [highlighter, setHighlighter] = useState<HighlighterCore | null>(null);

  useEffect(() => {
    let live = true;
    getHighlighter()
      .then((loaded) => {
        if (live) setHighlighter(loaded);
      })
      .catch(() => {
        /* highlighting is optional; plain code stays visible */
      });
    return () => {
      live = false;
    };
  }, []);

  const html = useMemo(() => renderHtml(content, highlighter), [content, highlighter]);

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    const copyButton = target.closest("[data-copy-code]");
    if (copyButton) {
      const block = copyButton.closest(".codeblock");
      const code = block?.querySelector("code")?.textContent ?? "";
      void copyText(code).then((ok) => toast(ok ? "Copied" : "Copy failed"));
      return;
    }
    const anchor = target.closest("a");
    const href = anchor?.getAttribute("href");
    if (!href || !/^https?:\/\//i.test(href)) return;
    event.preventDefault();
    openUrl(href).catch((error) => {
      console.error("Failed to open link", error);
    });
  };

  return (
    <div
      ref={ref}
      className="markdown text-sm leading-relaxed text-neutral-200 [&_a]:text-accent-link [&_code]:rounded-control [&_code]:bg-vault-raised [&_code]:px-1 [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_ol]:ml-5 [&_ol]:list-decimal [&_p]:mb-2 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-panel [&_pre]:p-3 [&_table]:w-full [&_td]:border [&_td]:border-vault-line [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-vault-line [&_th]:px-2 [&_th]:py-1 [&_ul]:mb-2 [&_.codeblock]:my-3 [&_.codeblock]:overflow-hidden [&_.codeblock]:rounded-panel [&_.codeblock]:border [&_.codeblock]:border-vault-line [&_.codeblock-head]:flex [&_.codeblock-head]:items-center [&_.codeblock-head]:justify-between [&_.codeblock-head]:bg-vault-raised [&_.codeblock-head]:px-3 [&_.codeblock-head]:py-1 [&_.codeblock-head]:text-xs [&_.codeblock-head]:text-muted [&_.codeblock-head_button]:rounded-control [&_.codeblock-head_button]:px-2 [&_.codeblock-head_button]:py-0.5 [&_.codeblock-head_button:hover]:bg-hover [&_.codeblock-head_button:hover]:text-text"
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
