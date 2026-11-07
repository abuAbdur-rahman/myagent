import type { ToolLogEntry } from "./types";

const GROUP_LABELS: Record<string, string> = {
  web_search: "Searched the web",
  web_fetch: "Read pages",
  research_run: "Ran research",
  get_time: "Checked the time",
  remember: "Saved memories",
  recall_memory: "Recalled memories",
  memory_pending: "Checked pending memories",
  update_memory: "Updated memories",
  delete_memory: "Deleted memories",
  conversation_search: "Searched past chats",
  run_powershell: "Ran PowerShell",
  sandbox_run: "Ran sandbox commands",
  sandbox_read: "Read project files",
  sandbox_glob: "Listed project files",
  sandbox_grep: "Searched project files",
  sandbox_write: "Wrote project files",
  sandbox_edit: "Edited project files",
  sandbox_delete: "Deleted project files",
  save_artifact: "Saved artifacts",
  todo_write: "Updated the checklist",
  todo_set: "Updated the checklist",
  ask_user: "Asked questions",
  delegate_task: "Delegated tasks",
  skill: "Loaded skills",
  describe_image: "Looked at images",
  read_document: "Read documents",
};

export function toolGroupLabel(name: string): string {
  const known = GROUP_LABELS[name];
  if (known) return known;
  const readable = name
    .replace(/^mcp__/, "")
    .replace(/__/g, " / ")
    .replace(/_/g, " ")
    .trim();
  return readable ? `Used ${readable}` : "Used tools";
}

export type ToolLogRow =
  | { kind: "single"; entry: ToolLogEntry }
  | { kind: "group"; name: string; label: string; entries: ToolLogEntry[] };

export function groupToolEntries(entries: ToolLogEntry[]): ToolLogRow[] {
  const order: string[] = [];
  const byName = new Map<string, ToolLogEntry[]>();
  for (const entry of entries) {
    const list = byName.get(entry.name);
    if (list) list.push(entry);
    else {
      byName.set(entry.name, [entry]);
      order.push(entry.name);
    }
  }
  return order.map((name) => {
    const list = byName.get(name) ?? [];
    if (list.length === 1) return { kind: "single", entry: list[0] };
    return { kind: "group", name, label: toolGroupLabel(name), entries: list };
  });
}
