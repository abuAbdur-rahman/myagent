const MAX_NOTES = 5;
const MAX_LENGTH = 240;
const MIN_SCORE = 0.75;

class MemoryParseError extends Error {
  constructor() {
    super("Could not read the extracted notes");
    this.name = "MemoryParseError";
  }
}

interface Candidate {
  text: string;
  score: number;
}

function candidateOf(item: unknown): Candidate | null {
  if (typeof item === "string") return { text: item, score: 1 };
  if (item === null || typeof item !== "object" || Array.isArray(item)) return null;
  const record = item as Record<string, unknown>;
  const text = record.text ?? record.content ?? record.note;
  if (typeof text !== "string") return null;
  const raw = record.score ?? record.confidence;
  const parsed =
    typeof raw === "number" ? raw : typeof raw === "string" ? Number.parseFloat(raw) : 0;
  const score = Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0;
  return { text, score };
}

function looksLikeCandidates(value: unknown[]): boolean {
  return value.length === 0 || value.some((item) => candidateOf(item) !== null);
}

function findArray(text: string): unknown[] | null | undefined {
  let start = text.indexOf("[");
  if (start === -1) return undefined;
  for (; start !== -1; start = text.indexOf("[", start + 1)) {
    let end = text.indexOf("]", start);
    while (end !== -1) {
      try {
        const value: unknown = JSON.parse(text.slice(start, end + 1));
        if (Array.isArray(value) && looksLikeCandidates(value)) {
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
    const candidate = candidateOf(item);
    if (!candidate || candidate.score < MIN_SCORE) continue;
    const note = candidate.text.replace(/\s+/g, " ").trim().slice(0, MAX_LENGTH);
    if (!note) continue;
    const key = note.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    notes.push(note);
    if (notes.length >= MAX_NOTES) break;
  }
  return notes;
}
