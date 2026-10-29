import type { McpConfig } from "./api";

export interface McpDraft {
  name: string;
  transport: string;
  authType: string;
  command: string;
  url: string;
  args: string;
  cwd: string;
  env: string;
  headers: string;
  timeoutMs: string;
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

function lines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function mcpArgsText(args: string[]): string {
  return args.join("\n");
}

function mcpPairText(pairs: Record<string, string>): string {
  return Object.entries(pairs)
    .map(([key, value]) => (value ? `${key}=${value}` : `${key}=`))
    .join("\n");
}

function parsePairs(value: string, label: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of lines(value)) {
    const index = line.indexOf("=");
    if (index <= 0) {
      throw new Error(`${label} lines must be KEY=VALUE.`);
    }
    out[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return out;
}

export function mcpConfigFromDraft(draft: McpDraft): McpConfig {
  const stdio = draft.transport === "stdio";
  const timeout = draft.timeoutMs.trim();
  const parsedTimeout = timeout ? Number(timeout) : null;
  if (parsedTimeout !== null && (!Number.isInteger(parsedTimeout) || parsedTimeout <= 0)) {
    throw new Error("Timeout must be a positive whole number of milliseconds.");
  }
  return {
    command: stdio ? draft.command.trim() || null : null,
    args: stdio ? lines(draft.args) : [],
    cwd: stdio ? draft.cwd.trim() || null : null,
    env: stdio ? parsePairs(draft.env, "Environment") : {},
    url: stdio ? null : draft.url.trim() || null,
    headers: stdio ? {} : parsePairs(draft.headers, "Header"),
    timeout_ms: parsedTimeout,
  };
}

export function mcpDraftFromConfig(
  base: Pick<McpDraft, "name" | "transport" | "authType">,
  config: McpConfig,
): McpDraft {
  return {
    ...base,
    command: config.command ?? "",
    url: config.url ?? "",
    args: mcpArgsText(config.args),
    cwd: config.cwd ?? "",
    env: mcpPairText(config.env),
    headers: mcpPairText(config.headers),
    timeoutMs: config.timeout_ms === null ? "" : String(config.timeout_ms),
  };
}
