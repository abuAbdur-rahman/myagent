export interface SettingsEntry {
  page: string;
  term: string;
}

export interface SettingsPageRef {
  id: string;
  label: string;
}

export interface SettingsHit {
  page: string;
  pageLabel: string;
  term: string | null;
}

const MAX_HITS = 12;

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

export function searchSettings(
  pages: SettingsPageRef[],
  index: SettingsEntry[],
  query: string,
): SettingsHit[] {
  const q = normalize(query);
  if (!q) return [];
  const labels = new Map(pages.map((page) => [page.id, page.label]));
  const scored: { hit: SettingsHit; score: number }[] = [];

  for (const page of pages) {
    const label = normalize(page.label);
    if (!label.includes(q)) continue;
    scored.push({
      hit: { page: page.id, pageLabel: page.label, term: null },
      score: label.startsWith(q) ? 0 : 1,
    });
  }

  for (const entry of index) {
    const pageLabel = labels.get(entry.page);
    if (pageLabel === undefined) continue;
    const term = normalize(entry.term);
    if (!term.includes(q)) continue;
    scored.push({
      hit: { page: entry.page, pageLabel, term: entry.term },
      score: term.startsWith(q) ? 2 : 3,
    });
  }

  return scored
    .sort((a, b) => a.score - b.score)
    .slice(0, MAX_HITS)
    .map((item) => item.hit);
}

export function hitKey(hit: SettingsHit | undefined): string {
  if (!hit) return "";
  return `${hit.page}\u0000${hit.term ?? ""}`;
}
