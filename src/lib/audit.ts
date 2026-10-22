import type { AuditLog } from "./types";

export type AuditDecision = "allow" | "ask" | "deny" | "other";
export type AuditDecisionFilter = "all" | AuditDecision;

export interface AuditCounts {
  total: number;
  allow: number;
  ask: number;
  deny: number;
  other: number;
}

export interface AuditDay {
  key: string;
  label: string;
  rows: AuditLog[];
}

export interface AuditToolCount {
  name: string;
  count: number;
}

export function decisionClass(decision: string): AuditDecision {
  const value = decision.trim().toLowerCase();
  if (value.startsWith("allow")) return "allow";
  if (value.startsWith("ask")) return "ask";
  if (value.startsWith("deny")) return "deny";
  return "other";
}

export function auditCounts(rows: AuditLog[]): AuditCounts {
  const counts: AuditCounts = { total: rows.length, allow: 0, ask: 0, deny: 0, other: 0 };
  for (const row of rows) {
    counts[decisionClass(row.decision)] += 1;
  }
  return counts;
}

export function auditSummary(counts: AuditCounts): string {
  if (counts.total === 0) return "No decisions";
  const parts = [`${counts.total} ${counts.total === 1 ? "decision" : "decisions"}`];
  if (counts.allow > 0) parts.push(`${counts.allow} allowed`);
  if (counts.ask > 0) parts.push(`${counts.ask} asked`);
  if (counts.deny > 0) parts.push(`${counts.deny} denied`);
  if (counts.other > 0) parts.push(`${counts.other} other`);
  return parts.join(" · ");
}

export function auditTools(rows: AuditLog[]): AuditToolCount[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.tool, (counts.get(row.tool) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function filterAudit(
  rows: AuditLog[],
  decision: AuditDecisionFilter,
  tool: string | null,
): AuditLog[] {
  return rows.filter((row) => {
    if (tool !== null && row.tool !== tool) return false;
    if (decision === "all") return true;
    return decisionClass(row.decision) === decision;
  });
}

function dayKey(ts: number): string {
  const date = new Date(ts);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

function dayLabel(key: string, now: Date): string {
  if (key === dayKey(now.getTime())) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (key === dayKey(yesterday.getTime())) return "Yesterday";
  return new Date(`${key}T00:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

export function groupAuditByDay(rows: AuditLog[], now: Date): AuditDay[] {
  const groups: AuditDay[] = [];
  const index = new Map<string, AuditDay>();
  for (const row of rows) {
    const key = dayKey(row.ts);
    const existing = index.get(key);
    if (existing) {
      existing.rows.push(row);
      continue;
    }
    const group: AuditDay = { key, label: dayLabel(key, now), rows: [row] };
    index.set(key, group);
    groups.push(group);
  }
  return groups;
}

export function auditTime(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function csvCell(value: string): string {
  if (!/[",\n\r]/.test(value)) return value;
  return `"${value.split('"').join('""')}"`;
}

export function auditCsv(rows: AuditLog[]): string {
  const lines = ["time,tool,decision,conversation,detail"];
  for (const row of rows) {
    lines.push(
      [
        new Date(row.ts).toISOString(),
        row.tool,
        row.decision,
        row.conversation_id ?? "",
        row.detail ?? "",
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return lines.join("\n");
}

export function auditJson(rows: AuditLog[]): string {
  return JSON.stringify(
    rows.map((row) => ({
      time: new Date(row.ts).toISOString(),
      tool: row.tool,
      decision: row.decision,
      conversation: row.conversation_id,
      detail: row.detail,
    })),
    null,
    2,
  );
}
