import { useEffect, useRef, type MouseEvent } from "react";
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
import html from "shiki/langs/html.mjs";
import css from "shiki/langs/css.mjs";
import sql from "shiki/langs/sql.mjs";
import yaml from "shiki/langs/yaml.mjs";
import java from "shiki/langs/java.mjs";
import c from "shiki/langs/c.mjs";
import cpp from "shiki/langs/cpp.mjs";
import markdown from "shiki/langs/markdown.mjs";

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
        html,
        css,
        sql,
        yaml,
        java,
        c,
        cpp,
        markdown,
      ],
      engine: createJavaScriptRegexEngine(),
    });
  }
  return highlighterPromise;
}

export function Markdown({ content }: { content: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const raw = marked.parse(content, { async: false }) as string;
  const html = DOMPurify.sanitize(raw);

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest("a");
    const href = anchor?.getAttribute("href");
    if (!href || !/^https?:\/\//i.test(href)) return;
    event.preventDefault();
    openUrl(href).catch((error) => {
      console.error("Failed to open link", error);
    });
  };

  useEffect(() => {
    let cancelled = false;
    const root = ref.current;
    if (!root) return;

    const blocks = Array.from(root.querySelectorAll("pre > code"));
    if (blocks.length === 0) return;

    getHighlighter()
      .then((highlighter) => {
        if (cancelled) return;
        for (const block of blocks) {
          const pre = block.parentElement;
          if (!pre) continue;
          const langClass = Array.from(block.classList).find((cls) =>
            cls.startsWith("language-"),
          );
          const raw = langClass?.replace("language-", "").toLowerCase() ?? "";
          const lang = ALIASES[raw];
          if (!lang || !highlighter.getLoadedLanguages().includes(lang)) continue;
          const code = block.textContent ?? "";
          pre.outerHTML = highlighter.codeToHtml(code, {
            lang,
            theme: "github-dark",
          });
        }
      })
      .catch(() => {
        /* highlighting is optional; plain code stays visible */
      });

    return () => {
      cancelled = true;
    };
  }, [html]);

  return (
    <div
      ref={ref}
      className="markdown text-sm leading-relaxed text-neutral-200 [&_a]:text-accent-link [&_code]:rounded-control [&_code]:bg-vault-raised [&_code]:px-1 [&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-semibold [&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1 [&_h3]:font-semibold [&_li]:ml-5 [&_li]:list-disc [&_ol]:ml-5 [&_ol]:list-decimal [&_p]:mb-2 [&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-panel [&_pre]:p-3 [&_table]:w-full [&_td]:border [&_td]:border-vault-line [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-vault-line [&_th]:px-2 [&_th]:py-1 [&_ul]:mb-2"
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
