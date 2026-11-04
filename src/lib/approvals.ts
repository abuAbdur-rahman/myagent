import type { ScreenVerdict } from "./types";

export type ApprovalKind = "command" | "web" | "call";

const COMMAND_TOOLS = new Set(["run_powershell", "sandbox_run"]);
const WEB_TOOLS = new Set(["web_fetch", "web_search"]);
const MEMORY_TOOLS = new Set(["update_memory", "delete_memory"]);

export function isMemoryApproval(tool: string): boolean {
  return MEMORY_TOOLS.has(tool);
}

export function approvalKind(tool: string): ApprovalKind {
  if (COMMAND_TOOLS.has(tool)) return "command";
  if (WEB_TOOLS.has(tool)) return "web";
  return "call";
}

export function approvalSubtitle(tool: string): string {
  if (isMemoryApproval(tool)) {
    return "Memory is sent with future chats. Review the note before allowing.";
  }
  return approvalKind(tool) === "command"
    ? "No rule matches this command, so it asks first."
    : "No rule matches this call, so it asks first.";
}

export function screenNote(screen: ScreenVerdict): string {
  const confidence = screen.score.toFixed(2);
  return screen.suggest_deny
    ? `${screen.label.toLowerCase()} ${confidence} · suggest deny`
    : `${screen.label.toLowerCase()} ${confidence} · no strong signal`;
}

export function approvalFootnote(tool: string, cwd: string, command: string): string {
  if (isMemoryApproval(tool)) {
    return "Applies once · memory approvals are never saved as a rule";
  }
  const first = (command.split("\n")[0] ?? command).slice(0, 60);
  const kind = approvalKind(tool);
  const scope =
    kind === "command"
      ? `in ${cwd} · Always allows these ${tool} commands`
      : kind === "web"
        ? `Always allows ${tool} every time`
        : `Always allows this ${tool} call`;
  return first ? `${scope} · ${first}` : scope;
}
