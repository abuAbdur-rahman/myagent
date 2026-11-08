import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { marked } from "marked";
import markedKatex from "marked-katex-extension";
import DOMPurify from "dompurify";
import "katex/dist/katex.min.css";
import { openUrl } from "@tauri-apps/plugin-opener";
import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
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
import airtableGrammar from "../lib/grammars/airtable.tmLanguage.json";
import { normalizeFenceLang } from "../lib/languages";
import { copyText } from "../lib/utils";
import { toast } from "../lib/toast";
import { myagentDark, myagentLight } from "../lib/shiki-theme";
import { useThemeName, type ThemeName } from "../lib/useThemeName";

let highlighterPromise: Promise<HighlighterCore> | null = null;

function getHighlighter(): Promise<HighlighterCore> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [myagentDark, myagentLight],
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
        airtableGrammar,
      ],
      engine: createJavaScriptRegexEngine(),
    });
  }
  return highlighterPromise;
}

marked.use(markedKatex({ throwOnError: false, output: "html", nonStandard: true }));

function unescapeMarked(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function looksLikeMarkdown(text: string): boolean {
  return /(^|\n)(#{1,6}\s|[-*+]\s|\d+\.\s|>\s)|(\*\*[^*]+\*\*)/.test(text);
}

function renderMarkdownFence(source: string): string {
  const html = marked.parse(unescapeMarked(source), { async: false, breaks: true }) as string;
  return `<div class="md-fence">${DOMPurify.sanitize(html)}</div>`;
}

function renderHtml(content: string, highlighter: HighlighterCore | null, theme: ThemeName): string {
  const raw = marked.parse(content, { async: false, breaks: true }) as string;
  let html = DOMPurify.sanitize(raw);

  html = html.replace(
    /<pre><code([^>]*)>([\s\S]*?)<\/code><\/pre>/g,
    (_match, attrs: string, escaped: string) => {
      const classValue = /class="([^"]*)"/.exec(attrs)?.[1] ?? "";
      const languageClass = classValue
        .split(/\s+/)
        .find((item) => item.startsWith("language-"))
        ?.slice("language-".length);
      const fence = (languageClass ?? "").trim();
      const plain = unescapeMarked(escaped).replace(/\n$/, "");

      if (fence === "mermaid") {
        return `<div class="mermaid-src" data-src="${encodeURIComponent(plain)}"><span>Rendering diagram…</span></div>`;
      }

      if (
        fence === "md" ||
        fence === "markdown" ||
        (fence === "txt" && looksLikeMarkdown(plain))
      ) {
        return renderMarkdownFence(escaped);
      }

      const lang = normalizeFenceLang(fence.toLowerCase());
      const label = fence || "text";
      const highlighted =
        highlighter && lang && highlighter.getLoadedLanguages().includes(lang)
          ? highlighter.codeToHtml(plain, {
              lang,
              theme: theme === "dark" ? "myagent-dark" : "myagent-light",
            })
          : `<pre class="codeblock-body"><code>${escaped.replace(/\n$/, "")}</code></pre>`;
      const header =
        `<div class="codeblock-head"><span>${label}</span>` +
        `<button type="button" data-copy-code="1">Copy</button></div>`;
      return `<div class="codeblock">${header}${highlighted}</div>`;
    },
  );
  return DOMPurify.sanitize(html);
}

export function Markdown({ content, compact }: { content: string; compact?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [highlighter, setHighlighter] = useState<HighlighterCore | null>(null);
  const theme = useThemeName();

  useEffect(() => {
    let live = true;
    getHighlighter()
      .then((loaded) => {
        if (live) setHighlighter(loaded);
      })
      .catch((error: unknown) => {
        console.warn("Markdown highlighting unavailable", error);
      });
    return () => {
      live = false;
    };
  }, []);

  const html = useMemo(
    () => renderHtml(content, highlighter, theme),
    [content, highlighter, theme],
  );

  const mermaidSeq = useRef(0);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const nodes = Array.from(root.querySelectorAll<HTMLElement>(".mermaid-src"));
    if (nodes.length === 0) return;
    let live = true;
    const timer = setTimeout(() => {
      void import("mermaid")
        .then(async ({ default: mermaid }) => {
          mermaid.initialize({
            startOnLoad: false,
            securityLevel: "strict",
            theme: theme === "dark" ? "dark" : "default",
          });
          for (const node of nodes) {
            if (!live) return;
            const source = decodeURIComponent(node.dataset.src ?? "");
            try {
              const { svg } = await mermaid.render(`mermaid-${mermaidSeq.current++}`, source);
              if (live) node.innerHTML = svg;
            } catch {
              node.textContent = source;
              node.classList.add("mermaid-error");
            }
          }
        })
        .catch((error: unknown) => console.warn("Mermaid unavailable", error));
    }, 350);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [html, theme]);

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
      className={compact ? "markdown markdown-compact" : "markdown"}
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
