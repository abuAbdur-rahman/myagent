export interface McpSummaryServer {
  id: string;
  enabled: boolean;
}

export interface McpSummaryProbe {
  error?: string | null;
  tools?: unknown[];
}

export interface McpSummary {
  servers: number;
  enabled: number;
  connected: number;
  tools: number;
}

export function mcpSummary(
  servers: McpSummaryServer[],
  probes: Record<string, McpSummaryProbe | undefined>,
): McpSummary {
  let enabled = 0;
  let connected = 0;
  let tools = 0;
  for (const server of servers) {
    if (!server.enabled) continue;
    enabled += 1;
    const probe = probes[server.id];
    if (!probe || probe.error) continue;
    connected += 1;
    tools += probe.tools?.length ?? 0;
  }
  return { servers: servers.length, enabled, connected, tools };
}

export function mcpSummaryText(summary: McpSummary): string {
  const parts = [
    `${summary.servers} ${summary.servers === 1 ? "server" : "servers"}`,
    `${summary.connected} connected`,
  ];
  if (summary.servers > 0) parts.push(`${summary.tools} ${summary.tools === 1 ? "tool" : "tools"}`);
  return parts.join(" · ");
}
