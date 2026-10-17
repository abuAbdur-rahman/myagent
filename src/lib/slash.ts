export interface SlashCommand {
  name: string;
  label: string;
  hint?: string;
  takesArgs?: boolean;
  shadowed?: boolean;
}

export interface FileCommand {
  name: string;
  description: string;
  body: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: "new", label: "New chat" },
  { name: "clear", label: "Clear this chat" },
  { name: "compact", label: "Compact context now" },
  { name: "export", label: "Export chat", hint: "[md|json]", takesArgs: true },
  { name: "model", label: "Switch model", hint: "[id]", takesArgs: true },
  { name: "memory", label: "Open memory" },
  { name: "settings", label: "Open settings" },
];

export function parseSlash(text: string): { name: string; args: string } | null {
  const match = text.trim().match(/^\/([\w-]+)(?:\s+([\s\S]*))?$/);
  if (!match) return null;
  return { name: match[1].toLowerCase(), args: (match[2] ?? "").trim() };
}

export function matchSlash(query: string, commands: SlashCommand[] = SLASH_COMMANDS): SlashCommand[] {
  const q = query.replace(/^\//, "").toLowerCase();
  return commands.filter((command) => command.name.startsWith(q));
}

export function mergeSlashCommands(files: FileCommand[]): SlashCommand[] {
  const builtins = new Set(SLASH_COMMANDS.map((command) => command.name));
  const merged: SlashCommand[] = [...SLASH_COMMANDS];
  for (const file of files) {
    if (builtins.has(file.name)) {
      const index = merged.findIndex((command) => command.name === file.name);
      if (index >= 0) {
        merged[index] = { ...merged[index], shadowed: true };
      }
      continue;
    }
    merged.push({
      name: file.name,
      label: file.description,
      hint: "$ARGUMENTS",
      takesArgs: true,
    });
  }
  return merged;
}

export function expandFileCommand(
  command: FileCommand,
  args: string,
): { text: string; appended: boolean } {
  if (command.body.includes("$ARGUMENTS")) {
    return { text: command.body.split("$ARGUMENTS").join(args), appended: false };
  }
  if (!args) return { text: command.body, appended: false };
  return { text: `${command.body}\n${args}`, appended: true };
}

export function resolveExportFormat(args: string): "md" | "json" | null {
  const value = args.trim().toLowerCase();
  if (value === "" || value === "md" || value === "markdown") return "md";
  if (value === "json") return "json";
  return null;
}

export type ModelArgResult =
  | { kind: "picker" }
  | { kind: "set"; id: string }
  | { kind: "unknown" }
  | { kind: "ambiguous"; matches: string[] };

export function resolveModelArg(args: string, models: string[]): ModelArgResult {
  const query = args.trim();
  if (!query) return { kind: "picker" };
  const lowered = query.toLowerCase();
  const exact = models.find((model) => model.toLowerCase() === lowered);
  if (exact) return { kind: "set", id: exact };
  const matches = models.filter((model) => model.toLowerCase().includes(lowered));
  if (matches.length === 1) return { kind: "set", id: matches[0] };
  if (matches.length === 0) return { kind: "unknown" };
  return { kind: "ambiguous", matches: matches.slice(0, 5) };
}

export interface SlashHandlers {
  new: (args: string) => void;
  clear: (args: string) => void;
  compact: (args: string) => void;
  export: (args: string) => void;
  model: (args: string) => void;
  memory: (args: string) => void;
  settings: (args: string) => void;
}

export function dispatchSlash(text: string, handlers: SlashHandlers): boolean {
  const parsed = parseSlash(text);
  if (!parsed) return false;
  const handler = handlers[parsed.name as keyof SlashHandlers];
  if (typeof handler !== "function") return false;
  handler(parsed.args);
  return true;
}
