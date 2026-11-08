const MAX_NOTES = 5;
const MAX_LENGTH = 240;

class MemoryParseError extends Error {
  constructor() {
    super("Could not read the extracted notes");
    this.name = "MemoryParseError";
  }
}

function findArray(text: string): unknown[] | null | undefined {
  let start = text.indexOf("[");
  if (start === -1) return undefined;
  for (; start !== -1; start = text.indexOf("[", start + 1)) {
    let end = text.indexOf("]", start);
    while (end !== -1) {
      try {
        const value: unknown = JSON.parse(text.slice(start, end + 1));
        if (
          Array.isArray(value) &&
          (value.length === 0 || value.some((item) => typeof item === "string"))
        ) {
          return value;
        }
      } catch {
        // Not the end of the array yet; extend to the next closing bracket.
      }
      end = text.indexOf("]", end + 1);
    }
  }
  return null;
}

export function parseExtractedNotes(raw: string): string[] {
  const text = raw.trim();
  if (!text) return [];
  const parsed = findArray(text);
  if (parsed === undefined) return [];
  if (parsed === null) throw new MemoryParseError();
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
