const KNOWN_TOOLS = [
  "get_time",
  "remember",
  "recall_memory",
  "run_powershell",
  "save_artifact",
  "web_fetch",
  "web_search",
] as const;

type KnownToolName = (typeof KNOWN_TOOLS)[number];

export function isKnownTool(name: string): name is KnownToolName {
  return (KNOWN_TOOLS as readonly string[]).includes(name);
}

export function toolListSentence(): string {
  return KNOWN_TOOLS.join(", ");
}
