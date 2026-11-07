const MAX_NOTES = 5;
const MAX_LENGTH = 240;

export function parseExtractedNotes(raw: string): string[] {
  const text = raw.trim();
  if (!text) return [];
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start === -1 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const seen = new Set<string>();
  const notes: string[] = [];
  for (const item of parsed) {
    if (typeof item !== "string") continue;
    const note = item.replace(/\s+/g, " ").trim().slice(0, MAX_LENGTH);
    if (!note) continue;
    const key = note.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    notes.push(note);
    if (notes.length >= MAX_NOTES) break;
  }
  return notes;
}
