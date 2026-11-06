import type { EpisodeHit } from "./api";

/** Characters of past-chat snippets injected on one turn. */
export const MAX_EPISODE_CHARS = 1600;
/** Past chats injected on one turn. */
export const MAX_EPISODE_HITS = 2;

function attr(value: string): string {
  return value.replace(/["<>\r\n]/g, " ").trim().slice(0, 120);
}

function bodyOf(hit: EpisodeHit): string {
  return hit.snippet.replace(/<\/?source[^>]*>/gi, "").trim();
}

/** Hits that actually fit the block budget, in ranking order. */
export function selectEpisodeHits(
  hits: EpisodeHit[],
  budgetChars = MAX_EPISODE_CHARS,
): EpisodeHit[] {
  const kept: EpisodeHit[] = [];
  let budget = budgetChars;
  for (const hit of hits.slice(0, MAX_EPISODE_HITS)) {
    if (budget <= 0) break;
    const body = bodyOf(hit);
    if (body.length === 0) continue;
    budget -= Math.min(body.length, budget);
    kept.push(hit);
  }
  return kept;
}

/**
 * Render past-chat snippets as citable data.
 *
 * The block is untrusted conversation text, never instructions, so it is
 * wrapped in `source` tags with the chat title and date the model can cite.
 */
export function buildEpisodeBlock(
  hits: EpisodeHit[],
  budgetChars = MAX_EPISODE_CHARS,
): string {
  if (hits.length === 0) return "";
  const parts: string[] = [];
  let budget = budgetChars;
  for (const hit of selectEpisodeHits(hits, budgetChars)) {
    if (budget <= 0) break;
    const body = bodyOf(hit);
    if (body.length === 0) continue;
    const text = body.length > budget ? `${body.slice(0, budget)}…` : body;
    budget -= text.length;
    parts.push(
      `<source chat="${attr(hit.title)}" date="${attr(hit.date)}" role="${attr(hit.role)}">${text}</source>`,
    );
  }
  if (parts.length === 0) return "";
  return `## Earlier conversations\n${parts.join("\n\n")}`;
}
