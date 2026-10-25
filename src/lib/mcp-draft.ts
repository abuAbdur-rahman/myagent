export interface McpDraft {
  name: string;
  transport: string;
  authType: string;
  command: string;
  url: string;
}

export function mcpDraftTarget(draft: McpDraft): string {
  return draft.transport === "stdio" ? draft.command : draft.url;
}

function mcpTargetMissingError(transport: string): string {
  return transport === "stdio" ? "Command is required." : "URL is required.";
}

export function mcpTargetError(draft: McpDraft): string | null {
  const target = mcpDraftTarget(draft).trim();
  if (!target) return mcpTargetMissingError(draft.transport);
  if (draft.transport === "stdio") return null;
  return /^https?:\/\//i.test(target) ? null : "URL must start with http:// or https://.";
}

export function mcpTargetArgs(draft: McpDraft): { cmd: string | null; url: string | null } {
  const target = mcpDraftTarget(draft).trim();
  return draft.transport === "stdio"
    ? { cmd: target, url: null }
    : { cmd: null, url: target };
}
