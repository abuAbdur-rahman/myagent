const KNOWN_TOOLS = [
  "get_time",
  "remember",
  "memory_pending",
  "recall_memory",
  "conversation_search",
  "update_memory",
  "delete_memory",
  "run_powershell",
  "sandbox_run",
  "sandbox_read",
  "sandbox_glob",
  "sandbox_grep",
  "sandbox_write",
  "sandbox_edit",
  "sandbox_delete",
  "save_artifact",
  "web_fetch",
  "web_search",
  "research_run",
  "todo_write",
  "todo_set",
  "ask_user",
  "delegate_task",
  "skill",
  "describe_image",
  "read_document",
] as const;

type KnownToolName = (typeof KNOWN_TOOLS)[number];

export function isKnownTool(name: string): name is KnownToolName {
  return (KNOWN_TOOLS as readonly string[]).includes(name);
}

export function toolListSentence(): string {
  return [
    "core: get_time, remember, memory_pending, recall_memory, conversation_search, update_memory, delete_memory, save_artifact, todo_write, todo_set, ask_user, skill",
    "research: web_search, web_fetch, research_run",
    "machine: run_powershell, sandbox_run, sandbox_read, sandbox_glob, sandbox_grep, sandbox_write, sandbox_edit, sandbox_delete",
    "delegation: delegate_task",
    "media/docs: describe_image, read_document",
  ].join("; ");
}
