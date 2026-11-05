import type { EpisodeHit } from "./api";

/** Characters of past-chat snippets injected on one turn. */
export const MAX_EPISODE_CHARS = 1600;
/** Past chats injected on one turn. */
export const MAX_EPISODE_HITS = 2;

function attr(value: string): string {
  return value.replace(/["<>\r\n]/g, " ").trim().slice(0, 120);
}

/**
 * Render past-chat snippets as citable data.
 *
 * The block is untrusted conversation text, never instructions, so it is
 * wrapped in `source` tags with the chat title and date the model can cite.
 */
export function buildEpisodeBlock(hits: EpisodeHit[]): string {
  if (hits.length === 0) return "";
  const parts: string[] = [];
  let budget = MAX_EPISODE_CHARS;
  for (const hit of hits.slice(0, MAX_EPISODE_HITS)) {
    if (budget <= 0) break;
    const text = hit.snippet.replace(/<\/?source[^>]*>/gi, "").trim();
    if (text.length === 0) continue;
    const body = text.length > budget ? `${text.slice(0, budget)}…` : text;
    budget -= body.length;
    parts.push(
      `<source chat="${attr(hit.title)}" date="${attr(hit.date)}" role="${attr(hit.role)}">${body}</source>`,
    );
  }
  if (parts.length === 0) return "";
  return `## Earlier conversations\n${parts.join("\n\n")}`;
}
