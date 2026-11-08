import type { Message } from "./types";

export function orderMessages(a: Message, b: Message): number {
  return a.created_at - b.created_at || a.id.localeCompare(b.id);
}

function childrenOf(parentId: string | null, rows: Message[]): Message[] {
  return rows
    .filter((row) => (row.parent_id ?? null) === parentId)
    .sort(orderMessages);
}

export function messagePath(
  leafId: string | null,
  byId: Map<string, Message>,
): Message[] {
  const out: Message[] = [];
  const seen = new Set<string>();
  let node = leafId ? byId.get(leafId) : undefined;
  while (node && !seen.has(node.id)) {
    seen.add(node.id);
    out.push(node);
    node = node.parent_id ? byId.get(node.parent_id) : undefined;
  }
  return out.reverse();
}

export function latestLeaf(rows: Message[]): string | null {
  if (rows.length === 0) return null;
  const ordered = [...rows].sort(orderMessages);
  return ordered[ordered.length - 1]?.id ?? null;
}

export function siblingVersions(message: Message, rows: Message[]): Message[] {
  return childrenOf(message.parent_id ?? null, rows);
}

export function deepestLeaf(nodeId: string, rows: Message[]): string {
  const seen = new Set<string>([nodeId]);
  let current = nodeId;
  for (;;) {
    const children = childrenOf(current, rows);
    const next = children[children.length - 1];
    if (!next || seen.has(next.id)) return current;
    seen.add(next.id);
    current = next.id;
  }
}

export function descendantsOf(
  id: string,
  rows: { id: string; parent_id?: string | null }[],
): Set<string> {
  const found = new Set<string>();
  const queue = [id];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const child of rows) {
      if ((child.parent_id ?? null) === current && !found.has(child.id)) {
        found.add(child.id);
        queue.push(child.id);
      }
    }
  }
  return found;
}

export interface VersionInfo {
  index: number;
  total: number;
}

export function versionMap(
  path: Message[],
  rows: Message[],
): Record<string, VersionInfo> {
  const map: Record<string, VersionInfo> = {};
  for (const message of path) {
    const siblings = siblingVersions(message, rows);
    if (siblings.length < 2) continue;
    const index = siblings.findIndex((sibling) => sibling.id === message.id);
    if (index >= 0) map[message.id] = { index: index + 1, total: siblings.length };
  }
  return map;
}
