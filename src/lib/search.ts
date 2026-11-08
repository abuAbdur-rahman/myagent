export function ftsQuery(input: string): string | null {
  const terms = input.trim().toLowerCase().match(/[\p{L}\p{N}_-]+/gu) ?? [];
  if (terms.length === 0) return null;
  return terms.map((term) => `"${term.replace(/"/g, "")}"`).join(" AND ");
}
