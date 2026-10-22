import {
  declaredArtifactSchema,
  toolLogEntrySchema,
  type DeclaredArtifact,
  type ToolLogEntry,
} from "./types";

export function parseDeclaredArtifacts(raw: unknown): DeclaredArtifact[] {
  if (typeof raw !== "string") return [];
  if (!raw) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    console.warn("parseDeclaredArtifacts: invalid JSON, dropping artifacts");
    return [];
  }
  if (!Array.isArray(value)) return [];
  const artifacts: DeclaredArtifact[] = [];
  for (const entry of value) {
    const parsed = declaredArtifactSchema.safeParse(entry);
    if (parsed.success) artifacts.push(parsed.data);
  }
  return artifacts;
}

export function parseToolLog(raw: unknown): ToolLogEntry[] {
  if (typeof raw !== "string" && !Array.isArray(raw)) return [];
  let value: unknown = raw;
  if (typeof raw === "string") {
    if (!raw) return [];
    try {
      value = JSON.parse(raw);
    } catch {
      console.warn("parseToolLog: invalid JSON, dropping tool log");
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const entries: ToolLogEntry[] = [];
  for (const entry of value) {
    const parsed = toolLogEntrySchema.safeParse(entry);
    if (parsed.success) entries.push(parsed.data);
  }
  return entries;
}
