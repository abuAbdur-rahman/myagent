import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Monitor,
  Moon,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
  Sun,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useApp, type ThemeMode } from "../../lib/store";
import * as api from "../../lib/api";
import { SEARCH_KEY_ACCOUNT } from "../../lib/api";
import * as db from "../../lib/db";
import { MemoryEditor } from "../MemoryEditor";
import {
  Badge,
  Button,
  Dialog,
  IconButton,
  Input,
  Pill,
  Segmented,
  Spinner,
  Toggle,
  type PillTone,
} from "../ui";
import { DropdownMenu, Select, type MenuEntry } from "../ui/select";
import { confirmDialog } from "../ConfirmDialog";
import { downloadText, errorText } from "../../lib/utils";
import { toast } from "../../lib/toast";
import { cn } from "../../lib/utils";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useAppUpdate } from "./useAppUpdate";
import type { AuditLog, Memory } from "../../lib/types";

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border px-2 py-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {description && <div className="text-xs text-muted">{description}</div>}
      </div>
      <div className="flex w-[260px] flex-none items-center justify-end gap-1.5">{children}</div>
    </div>
  );
}

const MCP_TARGET_HINTS: Record<string, { placeholder: string; label: string }> = {
  stdio: { placeholder: "npx my-server", label: "Command" },
  sse: { placeholder: "https://host:8000/sse", label: "URL" },
};

const MCP_TRANSPORTS = [
  { value: "stdio", label: "stdio (local command)" },
  { value: "sse", label: "sse (remote URL)" },
];

interface McpPreset {
  id: string;
  label: string;
  transport: string;
  target: string;
}

const MCP_PRESETS: McpPreset[] = [
  {
    id: "filesystem",
    label: "Filesystem",
    transport: "stdio",
    target: "npx -y @modelcontextprotocol/server-filesystem .",
  },
  {
    id: "fetch",
    label: "Fetch",
    transport: "stdio",
    target: "npx -y @modelcontextprotocol/server-fetch",
  },
  {
    id: "git",
    label: "Git",
    transport: "stdio",
    target: "npx -y @modelcontextprotocol/server-git --repository .",
  },
];

type McpDecision = "ask" | "allow" | "block";

interface McpDraft {
  name: string;
  transport: string;
  command: string;
  url: string;
}

interface McpPolicy {
  ask: string[];
  allow: string[];
  deny: string[];
}

interface McpDialogState {
  open: boolean;
  editing: api.McpServerRow | null;
  seed: McpDraft | null;
}

interface McpErrors {
  name?: string;
  target?: string;
}

type McpState = { tone: PillTone; label: string };

const CLOSED_MCP_DIALOG: McpDialogState = { open: false, editing: null, seed: null };

const EMPTY_MCP_DRAFT: McpDraft = { name: "", transport: "stdio", command: "", url: "" };

const MCP_MODES: { value: string; label: string }[] = [
  { value: "ask", label: "Ask" },
  { value: "allow", label: "Allow" },
  { value: "deny", label: "Block" },
];

const MCP_DECISIONS: { value: McpDecision; label: string }[] = [
  { value: "ask", label: "Ask" },
  { value: "allow", label: "Allow" },
  { value: "block", label: "Block" },
];

const MCP_COMMAND_HINT = "Run on this machine. A missing binary shows as Failed until it starts.";
const MCP_URL_HINT =
  "Reached over the network. The URL is fetched from the Rust side, never the webview.";
const MCP_NAME_HINT = "Letters, numbers, hyphen, or underscore. Shown on every approval prompt.";

function mcpProjectId(project: { id: string } | null | undefined): string | null {
  return project?.id ?? null;
}

function mcpScope(project: { name: string } | null | undefined): string {
  return project ? "Project: " + project.name : "Global (all chats)";
}

function mcpTarget(server: api.McpServerRow): string {
  return (server.transport === "stdio" ? server.cmd : server.url) ?? "";
}

function mcpTargetText(server: api.McpServerRow): { text: string; title?: string } {
  const raw = mcpTarget(server);
  return { text: raw || "No target set", title: raw || undefined };
}

function mcpDraftTarget(draft: McpDraft): string {
  return draft.transport === "stdio" ? draft.command : draft.url;
}

function mcpDraftWithTarget(draft: McpDraft, value: string): McpDraft {
  return draft.transport === "stdio" ? { ...draft, command: value } : { ...draft, url: value };
}

function mcpDraft(server: api.McpServerRow): McpDraft {
  return {
    name: server.name,
    transport: server.transport,
    command: server.cmd ?? "",
    url: server.url ?? "",
  };
}

function mcpPresetDraft(preset: McpPreset): McpDraft {
  const stdio = preset.transport === "stdio";
  return {
    name: preset.id,
    transport: preset.transport,
    command: stdio ? preset.target : "",
    url: stdio ? "" : preset.target,
  };
}

function mcpHint(transport: string) {
  return MCP_TARGET_HINTS[transport] ?? MCP_TARGET_HINTS.stdio;
}

function mcpPolicy(server: api.McpServerRow): McpPolicy {
  return {
    ask: api.mcpToolList(server.ask_tools),
    allow: api.mcpToolList(server.allow_tools),
    deny: api.mcpToolList(server.deny_tools),
  };
}

function mcpInherited(server: api.McpServerRow): McpDecision {
  if (server.approval_mode === "allow") return "allow";
  if (server.approval_mode === "deny") return "block";
  return "ask";
}

function mcpDecision(server: api.McpServerRow, tool: string): McpDecision {
  const policy = mcpPolicy(server);
  if (policy.deny.includes(tool)) return "block";
  if (policy.allow.includes(tool)) return "allow";
  if (policy.ask.includes(tool)) return "ask";
  return mcpInherited(server);
}

function mcpWithDecision(
  server: api.McpServerRow,
  tool: string,
  decision: McpDecision,
): McpPolicy {
  const policy = mcpPolicy(server);
  const rest = {
    ask: policy.ask.filter((name) => name !== tool),
    allow: policy.allow.filter((name) => name !== tool),
    deny: policy.deny.filter((name) => name !== tool),
  };
  if (decision === mcpInherited(server)) return rest;
  if (decision === "ask") rest.ask.push(tool);
  else if (decision === "allow") rest.allow.push(tool);
  else rest.deny.push(tool);
  return rest;
}

function mcpServerTools(probe: api.McpProbe | undefined): api.McpToolInfo[] {
  return probe?.tools ?? [];
}

function mcpAllowedCount(server: api.McpServerRow, tools: api.McpToolInfo[]): number {
  return tools.filter((tool) => mcpDecision(server, tool.name) === "allow").length;
}

function mcpProbeError(probe: api.McpProbe | undefined): string {
  return probe?.error || "Could not connect.";
}

function mcpNameFormatError(name: string): string | null {
  if (!name) return "Name is required.";
  if (name.length > 64) return "Keep the name under 64 characters.";
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return "Use letters, numbers, hyphen, or underscore.";
  return null;
}

function mcpNameError(
  name: string,
  servers: api.McpServerRow[],
  editing: string | null,
): string | null {
  const trimmed = name.trim();
  const format = mcpNameFormatError(trimmed);
  if (format) return format;
  const clash = servers.some((server) => server.id !== editing && server.name === trimmed);
  return clash ? "Another server in this scope already uses this name." : null;
}

function mcpTargetMissingError(transport: string): string {
  return transport === "stdio" ? "Command is required." : "URL is required.";
}

function mcpTargetError(draft: McpDraft): string | null {
  const target = mcpDraftTarget(draft).trim();
  if (!target) return mcpTargetMissingError(draft.transport);
  if (draft.transport !== "sse") return null;
  return /^https?:\/\//i.test(target) ? null : "URL must start with http:// or https://.";
}

function mcpErrors(
  draft: McpDraft,
  servers: api.McpServerRow[],
  editing: api.McpServerRow | null,
): McpErrors {
  const name = mcpNameError(draft.name, servers, editing?.id ?? null);
  const target = mcpTargetError(draft);
  return { name: name ?? undefined, target: target ?? undefined };
}

function mcpInvalid(error: string | undefined): boolean | undefined {
  return error ? true : undefined;
}

function mcpProbeState(probe: api.McpProbe | undefined, probing: boolean): McpState {
  if (probing) return { tone: "accent", label: "Connecting" };
  if (!probe) return { tone: "neutral", label: "Not checked" };
  return probe.status === "connected"
    ? { tone: "success", label: "Connected" }
    : { tone: "danger", label: "Failed" };
}

function mcpStatus(
  server: api.McpServerRow,
  probe: api.McpProbe | undefined,
  probing: boolean,
): McpState {
  if (!server.enabled) return { tone: "neutral", label: "Off" };
  return mcpProbeState(probe, probing);
}

function mcpToolSummary(count: number, allowed: number): string {
  const tools = count === 1 ? "1 tool" : count + " tools";
  return allowed > 0 ? tools + " · " + allowed + " always allowed" : tools;
}

function mcpDialogTitle(editing: api.McpServerRow | null): string {
  return editing ? "Edit " + editing.name : "Add MCP server";
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-2 flex items-start gap-2.5 rounded-card border border-border bg-surface px-3 py-2.5">
      <ShieldCheck size={15} className="mt-0.5 flex-none text-accent" aria-hidden />
      <p className="text-xs text-muted">{children}</p>
    </div>
  );
}

function McpPageHeader({
  scope,
  count,
  onAdd,
}: {
  scope: string;
  count: number;
  onAdd: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-2">
      <div className="min-w-0">
        <h3 className="text-sm font-medium">MCP servers</h3>
        <p className="text-xs text-muted">
          {scope} · {count} {count === 1 ? "server" : "servers"}
        </p>
      </div>
      <Button variant="primary" size="sm" onClick={onAdd}>
        <Plus size={14} />
        Add server
      </Button>
    </div>
  );
}

function McpToolList({
  server,
  tools,
  probing,
  onReconnect,
  onDecision,
}: {
  server: api.McpServerRow;
  tools: api.McpToolInfo[];
  probing: boolean;
  onReconnect: (id: string) => void;
  onDecision: (server: api.McpServerRow, tool: string, decision: McpDecision) => void;
}) {
  if (tools.length === 0) {
    return (
      <p className="text-xs text-muted">
        Tools are listed after a connection.{" "}
        <button
          type="button"
          className="underline hover:text-text"
          disabled={probing}
          onClick={() => onReconnect(server.id)}
        >
          Connect now
        </button>
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-0.5">
      <ul className="flex flex-col divide-y divide-border">
        {tools.map((tool) => (
          <li key={tool.name} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate font-mono text-xs">{tool.name}</div>
              {tool.description && (
                <div className="truncate text-xs text-muted" title={tool.description}>
                  {tool.description}
                </div>
              )}
            </div>
            <Segmented<McpDecision>
              value={mcpDecision(server, tool.name)}
              options={MCP_DECISIONS}
              onChange={(value) => onDecision(server, tool.name, value)}
              label={"Approval for " + tool.name}
            />
          </li>
        ))}
      </ul>
      <p className="pt-2 text-xs text-muted">
        Blocked tools are hidden from the model. Allowed tools run without asking.
      </p>
    </div>
  );
}

function McpToolsPanel(props: {
  server: api.McpServerRow;
  tools: api.McpToolInfo[];
  probing: boolean;
  onReconnect: (id: string) => void;
  onDecision: (server: api.McpServerRow, tool: string, decision: McpDecision) => void;
}) {
  if (!props.server.enabled) {
    return (
      <div className="border-t border-border px-3 py-2.5">
        <p className="text-xs text-muted">Enable this server to see its tools.</p>
      </div>
    );
  }
  return (
    <div className="border-t border-border px-3 py-2.5">
      <McpToolList {...props} />
    </div>
  );
}

function McpFailure({
  id,
  error,
  onReconnect,
}: {
  id: string;
  error: string;
  onReconnect: (id: string) => void;
}) {
  return (
    <div className="mt-1.5 flex items-start gap-1.5 text-xs text-danger">
      <TriangleAlert size={13} className="mt-0.5 flex-none" aria-hidden />
      <span className="min-w-0 break-words">{error}</span>
      <button
        type="button"
        className="flex-none underline hover:no-underline"
        onClick={() => onReconnect(id)}
      >
        Try again
      </button>
    </div>
  );
}

function McpIdentity({
  server,
  probe,
  state,
  onReconnect,
}: {
  server: api.McpServerRow;
  probe: api.McpProbe | undefined;
  state: McpState;
  onReconnect: (id: string) => void;
}) {
  const { text, title } = mcpTargetText(server);
  const failed = state.label === "Failed";
  return (
    <div className="min-w-0 flex-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="truncate text-sm font-medium">{server.name}</span>
        <Badge>{server.transport}</Badge>
        <Pill tone={state.tone}>{state.label}</Pill>
      </div>
      <div className="mt-0.5 truncate font-mono text-xs text-muted" title={title}>
        {text}
      </div>
      {failed && (
        <McpFailure id={server.id} error={mcpProbeError(probe)} onReconnect={onReconnect} />
      )}
    </div>
  );
}

function mcpServerMenu(
  server: api.McpServerRow,
  probing: boolean,
  handlers: {
    onEdit: (server: api.McpServerRow) => void;
    onRemove: (server: api.McpServerRow) => void;
    onReconnect: (id: string) => void;
  },
): MenuEntry[] {
  return [
    {
      id: "edit",
      label: "Edit",
      icon: <Pencil size={15} />,
      onSelect: () => handlers.onEdit(server),
    },
    {
      id: "reconnect",
      label: "Reconnect",
      icon: <RefreshCw size={15} />,
      disabled: !server.enabled || probing,
      onSelect: () => handlers.onReconnect(server.id),
    },
    { id: "separator", type: "separator" },
    {
      id: "remove",
      label: "Remove",
      icon: <Trash2 size={15} />,
      danger: true,
      onSelect: () => handlers.onRemove(server),
    },
  ];
}

function McpServerDefaults({
  server,
  summary,
  open,
  onToggleOpen,
  onApproval,
}: {
  server: api.McpServerRow;
  summary: string;
  open: boolean;
  onToggleOpen: () => void;
  onApproval: (id: string, mode: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-3 py-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted">Default for its tools</span>
        <Segmented<string>
          value={server.approval_mode}
          options={MCP_MODES}
          onChange={(value) => onApproval(server.id, value)}
          label={"Default approval for " + server.name}
        />
      </div>
      <div className="flex items-center gap-3">
        <span className="text-xs text-muted">{summary}</span>
        <Button variant="ghost" size="sm" aria-expanded={open} onClick={onToggleOpen}>
          {open ? "Hide tools" : "Tools"}
          <ChevronDown size={14} className={cn("transition-transform", open && "rotate-180")} />
        </Button>
      </div>
    </div>
  );
}

function McpServerCard({
  index,
  server,
  probe,
  probing,
  onToggle,
  onEdit,
  onRemove,
  onReconnect,
  onDecision,
  onApproval,
}: {
  index: number;
  server: api.McpServerRow;
  probe: api.McpProbe | undefined;
  probing: boolean;
  onToggle: (id: string, enabled: boolean) => void;
  onEdit: (server: api.McpServerRow) => void;
  onRemove: (server: api.McpServerRow) => void;
  onReconnect: (id: string) => void;
  onDecision: (server: api.McpServerRow, tool: string, decision: McpDecision) => void;
  onApproval: (id: string, mode: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const tools = mcpServerTools(probe);
  const state = mcpStatus(server, probe, probing);
  const menu = mcpServerMenu(server, probing, { onEdit, onRemove, onReconnect });

  return (
    <div
      className={cn(
        "rounded-card border border-border bg-surface",
        !server.enabled && "opacity-60",
      )}
    >
      <div className="flex items-start gap-3 px-3 py-3">
        <span className="mt-0.5 grid h-6 w-6 flex-none place-items-center rounded-control border border-border text-xs tabular-nums text-muted">
          {index + 1}
        </span>
        <McpIdentity server={server} probe={probe} state={state} onReconnect={onReconnect} />
        <Toggle
          checked={server.enabled}
          onChange={(next) => onToggle(server.id, next)}
          label={"Enable " + server.name}
        />
        <DropdownMenu
          align="end"
          aria-label={"Options for " + server.name}
          trigger={
            <IconButton label={"Options for " + server.name}>
              <MoreHorizontal size={16} />
            </IconButton>
          }
          items={menu}
        />
      </div>
      <McpServerDefaults
        server={server}
        summary={mcpToolSummary(tools.length, mcpAllowedCount(server, tools))}
        open={open}
        onToggleOpen={() => setOpen((current) => !current)}
        onApproval={onApproval}
      />
      {open && (
        <McpToolsPanel
          server={server}
          tools={tools}
          probing={probing}
          onReconnect={onReconnect}
          onDecision={onDecision}
        />
      )}
    </div>
  );
}

function McpEmptyState({ onPreset }: { onPreset: (preset: McpPreset) => void }) {
  return (
    <div className="mx-2 rounded-card border border-dashed border-border px-4 py-6 text-center">
      <p className="text-sm">No servers in this scope yet.</p>
      <p className="mt-1 text-xs text-muted">
        Start from a preset and edit the command if your setup differs.
      </p>
      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {MCP_PRESETS.map((preset) => (
          <Button key={preset.id} size="sm" onClick={() => onPreset(preset)}>
            {preset.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

function McpField({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium">{label}</span>
      {children}
      <span className="text-xs text-muted">{hint}</span>
      {error && <span className="text-xs text-danger">{error}</span>}
    </label>
  );
}

function McpDialogFields({
  draft,
  setDraft,
  errors,
  nameRef,
  targetRef,
}: {
  draft: McpDraft;
  setDraft: (draft: McpDraft) => void;
  errors: McpErrors;
  nameRef: React.RefObject<HTMLInputElement | null>;
  targetRef: React.RefObject<HTMLInputElement | null>;
}) {
  const hint = mcpHint(draft.transport);
  const stdio = draft.transport === "stdio";
  return (
    <div className="flex flex-col gap-3">
      <McpField label="Name" hint={MCP_NAME_HINT} error={errors.name}>
        <Input
          ref={nameRef}
          value={draft.name}
          autoComplete="off"
          placeholder="filesystem"
          aria-invalid={mcpInvalid(errors.name)}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
      </McpField>
      <McpField label="Transport" hint="How MyAgent reaches the server.">
        <Select
          value={draft.transport}
          onChange={(value) => setDraft({ ...draft, transport: value })}
          aria-label="Transport"
          options={MCP_TRANSPORTS}
        />
      </McpField>
      <McpField
        label={hint.label}
        hint={stdio ? MCP_COMMAND_HINT : MCP_URL_HINT}
        error={errors.target}
      >
        <Input
          ref={targetRef}
          value={mcpDraftTarget(draft)}
          autoComplete="off"
          placeholder={hint.placeholder}
          aria-invalid={mcpInvalid(errors.target)}
          onChange={(e) => setDraft(mcpDraftWithTarget(draft, e.target.value))}
        />
      </McpField>
    </div>
  );
}

function McpDialogFooter({
  editing,
  onClose,
  onSave,
}: {
  editing: boolean;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <div className="mt-4 flex justify-end gap-2">
      <Button variant="ghost" size="sm" onClick={onClose}>
        Cancel
      </Button>
      <Button variant="primary" size="sm" onClick={onSave}>
        {editing ? "Save" : "Add server"}
      </Button>
    </div>
  );
}

function McpServerDialog({
  open,
  editing,
  seed,
  servers,
  onClose,
  onSave,
}: {
  open: boolean;
  editing: api.McpServerRow | null;
  seed: McpDraft | null;
  servers: api.McpServerRow[];
  onClose: () => void;
  onSave: (draft: McpDraft) => void;
}) {
  const [draft, setDraft] = useState<McpDraft>(EMPTY_MCP_DRAFT);
  const [errors, setErrors] = useState<McpErrors>({});
  const nameRef = useRef<HTMLInputElement>(null);
  const targetRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(editing ? mcpDraft(editing) : (seed ?? EMPTY_MCP_DRAFT));
    setErrors({});
  }, [open, editing, seed]);

  const submit = () => {
    const found = mcpErrors(draft, servers, editing);
    setErrors(found);
    if (found.name) {
      nameRef.current?.focus();
      return;
    }
    if (found.target) {
      targetRef.current?.focus();
      return;
    }
    onSave(draft);
  };

  return (
    <Dialog open={open} onClose={onClose} title={mcpDialogTitle(editing)}>
      <McpDialogFields
        draft={draft}
        setDraft={setDraft}
        errors={errors}
        nameRef={nameRef}
        targetRef={targetRef}
      />
      <McpDialogFooter
        editing={editing !== null}
        onClose={onClose}
        onSave={submit}
      />
    </Dialog>
  );
}

function useMcpServers(projectId: string | null) {
  const [servers, setServers] = useState<api.McpServerRow[]>([]);
  const [probes, setProbes] = useState<Record<string, api.McpProbe>>({});
  const [probing, setProbing] = useState<Record<string, boolean>>({});
  const [status, setStatus] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const rows = await api.mcpList(projectId);
      setServers(rows);
      const cached = await api.mcpStatus();
      setProbes(Object.fromEntries(cached.map((probe) => [probe.id, probe])));
    } catch (e) {
      setStatus(errorText(e));
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = useCallback(
    async (action: () => Promise<unknown>, message?: string) => {
      try {
        await action();
        setStatus(null);
        if (message) toast(message);
        await reload();
      } catch (e) {
        setStatus(errorText(e));
      }
    },
    [reload],
  );

  const reconnect = useCallback((id: string) => {
    setProbing((current) => ({ ...current, [id]: true }));
    void api
      .mcpProbe(id)
      .then((probe) => {
        setProbes((current) => ({ ...current, [id]: probe }));
        setStatus(null);
      })
      .catch((e: unknown) => setStatus(errorText(e)))
      .finally(() => setProbing((current) => ({ ...current, [id]: false })));
  }, []);

  return { servers, probes, probing, status, run, reconnect };
}

function AuditRow({ row }: { row: AuditLog }) {
  const detail = row.detail ? ` · ${row.detail}` : "";
  return (
    <SettingRow
      label={row.tool}
      description={`${row.decision} · ${new Date(row.ts).toLocaleString()}${detail}`}
    >
      <span className="text-xs text-muted">{row.conversation_id ?? "global"}</span>
    </SettingRow>
  );
}

function auditEmptyText(search: string): string {
  return search.trim() ? "No matching audit entries." : "No approval decisions recorded yet.";
}

function modelSelectData(models: string[]) {
  const options = models.map((id) => ({ value: id, label: id }));
  const has = models.length > 0;
  return {
    options,
    visionOptions: [{ value: "", label: "None (text only)" }, ...options],
    placeholder: has ? "Select a model" : "No models",
    visionPlaceholder: has ? "None" : "No models",
  };
}

export function GeneralPage() {
  const {
    displayName,
    setDisplayName,
    sendWith,
    setSendWith,
    autoCompact,
    setAutoCompact,
    collapseThinking,
    setCollapseThinking,
    collapseToolCalls,
    setCollapseToolCalls,
  } = useApp();
  return (
    <div>
      <SettingRow label="Display name" description="Used in the greeting and profile">
        <Input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Your name"
          aria-label="Display name"
        />
      </SettingRow>
      <SettingRow label="Send message with" description="Keyboard shortcut to send">
        <Select
          size="sm"
          value={sendWith}
          onChange={(mode) => setSendWith(mode)}
          aria-label="Send message with"
          options={[
            { value: "enter", label: "Enter" },
            { value: "ctrl", label: "Ctrl+Enter" },
          ]}
        />
      </SettingRow>
      <SettingRow label="Auto-compact context" description="Summarize older messages at 80% context">
        <Toggle
          checked={autoCompact}
          onChange={setAutoCompact}
          label="Auto-compact context"
        />
      </SettingRow>
      <SettingRow label="Collapse thinking" description="Fold reasoning blocks once the reply is done">
        <Toggle
          checked={collapseThinking}
          onChange={setCollapseThinking}
          label="Collapse thinking"
        />
      </SettingRow>
      <SettingRow label="Collapse tool calls" description="Fold the tool-call list when a new turn starts">
        <Toggle
          checked={collapseToolCalls}
          onChange={setCollapseToolCalls}
          label="Collapse tool calls"
        />
      </SettingRow>
    </div>
  );
}

export function McpPage() {
  const { activeProject } = useApp();
  const projectId = mcpProjectId(activeProject);
  const { servers, probes, probing, status, run, reconnect } = useMcpServers(projectId);
  const [dialog, setDialog] = useState<McpDialogState>(CLOSED_MCP_DIALOG);

  const save = (draft: McpDraft) => {
    const name = draft.name.trim();
    const target = mcpDraftTarget(draft).trim();
    const cmd = draft.transport === "stdio" ? target : null;
    const url = draft.transport === "sse" ? target : null;
    const current = dialog.editing;
    setDialog(CLOSED_MCP_DIALOG);
    void run(
      () =>
        current
          ? api.mcpUpdate(current.id, name, draft.transport, cmd, url)
          : api.mcpAdd(projectId, name, draft.transport, cmd, url),
      current ? "Server updated" : "Server added. It connects on the next send.",
    );
  };

  const remove = async (server: api.McpServerRow) => {
    const confirmed = await confirmDialog({
      title: "Remove " + server.name + "?",
      body: "The server, its tool policy, and its cached tools are removed from this scope.",
      danger: true,
      ok: "Remove",
    });
    if (confirmed) void run(() => api.mcpRemove(server.id), "Server removed");
  };

  const decide = (server: api.McpServerRow, tool: string, decision: McpDecision) => {
    const policy = mcpWithDecision(server, tool, decision);
    void run(() => api.mcpSetPolicy(server.id, policy.ask, policy.allow, policy.deny));
  };

  const close = () => setDialog(CLOSED_MCP_DIALOG);

  return (
    <div className="flex flex-col gap-3 pb-2">
      <McpPageHeader
        scope={mcpScope(activeProject)}
        count={servers.length}
        onAdd={() => setDialog({ open: true, editing: null, seed: null })}
      />
      <Callout>
        Every tool call asks first until you decide otherwise. Allow runs a tool without asking,
        Block hides it from the model, and a per-tool choice overrides the server default.
      </Callout>
      {servers.length === 0 ? (
        <McpEmptyState
          onPreset={(preset) => setDialog({ open: true, editing: null, seed: mcpPresetDraft(preset) })}
        />
      ) : (
        <div className="flex flex-col gap-2 px-2">
          {servers.map((server, index) => (
            <McpServerCard
              key={server.id}
              index={index}
              server={server}
              probe={probes[server.id]}
              probing={probing[server.id] === true}
              onToggle={(id, enabled) =>
                void run(
                  () => api.mcpToggle(id, enabled),
                  enabled ? "Server enabled" : "Server disabled",
                )
              }
              onEdit={(target) => setDialog({ open: true, editing: target, seed: null })}
              onRemove={(target) => void remove(target)}
              onReconnect={reconnect}
              onDecision={decide}
              onApproval={(id, mode) => void run(() => api.mcpSetApproval(id, mode))}
            />
          ))}
        </div>
      )}
      {status && (
        <p className="px-2 text-xs text-muted" role="status">
          {status}
        </p>
      )}
      <McpServerDialog
        open={dialog.open}
        editing={dialog.editing}
        seed={dialog.seed}
        servers={servers}
        onClose={close}
        onSave={save}
      />
    </div>
  );
}

export function AuditPage() {
  const [rows, setRows] = useState<AuditLog[]>([]);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  const reload = useCallback(async () => {
    try {
      setRows(await db.listAuditLogs(debounced));
      setStatus(null);
      setLoaded(true);
    } catch (e) {
      setStatus(errorText(e));
      setLoaded(true);
    }
  }, [debounced]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const clear = async () => {
    const confirmed = await confirmDialog({
      title: "Clear the audit log?",
      body: "Every recorded approval decision will be permanently removed. This cannot be undone.",
      danger: true,
      ok: "Clear log",
    });
    if (!confirmed) return;
    try {
      await db.clearAuditLog();
      toast("Audit log cleared");
      await reload();
    } catch (e) {
      setStatus(errorText(e));
    }
  };

  return (
    <div>
      <SettingRow label="Search" description="Filter by tool, decision or detail">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="web_fetch"
          aria-label="Search audit log"
          autoComplete="off"
        />
      </SettingRow>
      {loaded && rows.length === 0 && (
        <p className="px-2 py-3 text-xs text-muted">{auditEmptyText(search)}</p>
      )}
      {rows.map((row) => (
        <AuditRow key={row.id} row={row} />
      ))}
      <SettingRow label="Clear log" description="Remove every recorded decision">
        <Button variant="danger" size="sm" onClick={() => void clear()}>
          Clear
        </Button>
      </SettingRow>
      {status && (
        <p className="px-2 py-2 text-xs text-muted" role="status">
          {status}
        </p>
      )}
    </div>
  );
}

export function SearchPage() {  const { searchBackend, setSearchBackend, searchEndpoint, setSearchEndpoint } = useApp();
  const [key, setKey] = useState("");
  const [keyCount, setKeyCount] = useState(0);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    api.searchKeyCount().then(setKeyCount).catch(() => undefined);
  }, []);

  const save = async () => {
    if (!key.trim()) {
      setStatus("Enter a Tavily API key.");
      return;
    }
    try {
      const count = await api.addSearchKey(key.trim());
      setKeyCount(count);
      setKey("");
      setStatus(count > 1 ? `Search key added (${count} stored, rotates on quota).` : "Search key saved.");
    } catch (e) {
      setStatus(errorText(e));
    }
  };

  const removeOne = async (index: number) => {
    try {
      const count = await api.removeSearchKey(index);
      setKeyCount(count);
      setStatus(count === 0 ? "Search keys removed." : `Key removed (${count} left).`);
    } catch (e) {
      setStatus(errorText(e));
    }
  };

  const clear = async () => {
    try {
      await api.deleteApiKey(SEARCH_KEY_ACCOUNT);
      setKeyCount(0);
      setStatus("Search keys removed.");
    } catch (e) {
      setStatus(errorText(e));
    }
  };

  return (
    <div>
      <SettingRow label="Provider" description="Search runs locally through this provider">
        <Select
          size="sm"
          value={searchBackend}
          onChange={(backend) => setSearchBackend(backend)}
          aria-label="Search provider"
          options={[
            { value: "tavily", label: "Tavily" },
            { value: "searxng", label: "SearXNG (self-hosted)" },
          ]}
        />
      </SettingRow>
      {searchBackend === "tavily" && (
        <SettingRow
          label="Tavily API keys"
          description={
            keyCount > 0
              ? `${keyCount} key${keyCount === 1 ? "" : "s"} stored — rotates on quota`
              : "Stored in Windows Credential Manager"
          }
        >
          <Input
            type="password"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="tvly-…"
            aria-label="Tavily API key"
            autoComplete="off"
          />
          <Button variant="primary" onClick={() => void save()}>
            Add key
          </Button>
          {keyCount > 0 && (
            <Button variant="danger" onClick={() => void clear()}>
              Remove all
            </Button>
          )}
        </SettingRow>
      )}
      {searchBackend === "tavily" && keyCount > 0 && (
        <SettingRow label="Stored keys" description="First key is tried first">
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: keyCount }, (_, index) => (
              <span
                key={index}
                className="inline-flex items-center gap-2 rounded-control border border-border px-2 py-1 text-xs"
              >
                Key {index + 1}
                <Button variant="ghost" size="sm" onClick={() => void removeOne(index)}>
                  Remove
                </Button>
              </span>
            ))}
          </div>
        </SettingRow>
      )}
      {searchBackend === "searxng" && (
        <SettingRow label="SearXNG endpoint" description="Local instance that returns format=json">
          <Input
            value={searchEndpoint}
            onChange={(e) => setSearchEndpoint(e.target.value)}
            placeholder="http://127.0.0.1:8888"
            aria-label="SearXNG endpoint"
          />
        </SettingRow>
      )}
      {status && (
        <p className="px-2 py-2 text-xs text-muted" role="status">
          {status}
        </p>
      )}
    </div>
  );
}

const ACCENTS: [string, string][] = [
  ["Clay", "#c96442"],
  ["Blue", "#0067c0"],
  ["Green", "#0f7b0f"],
  ["Purple", "#7a42d6"],
  ["Pink", "#c239b3"],
  ["Graphite", "#5c5c5c"],
];

const THEME_TILES: { id: ThemeMode; label: string; icon: React.ReactNode; preview: string }[] = [
  { id: "light", label: "Light", icon: <Sun size={16} />, preview: "#ffffff" },
  { id: "dark", label: "Dark", icon: <Moon size={16} />, preview: "#2b2b2b" },
  {
    id: "system",
    label: "System",
    icon: <Monitor size={16} />,
    preview: "linear-gradient(90deg,#fff 50%,#2b2b2b 50%)",
  },
];

export function AppearancePage() {
  const { theme, setTheme, accent, setAccent } = useApp();
  return (
    <div>
      <SettingRow label="Theme" description="Applies instantly">
        <div className="flex gap-2.5">
          {THEME_TILES.map((tile) => (
            <button
              key={tile.id}
              type="button"
              onClick={() => setTheme(tile.id)}
              aria-pressed={theme === tile.id}
              className={cn(
                "flex w-[110px] flex-col items-center gap-1.5 rounded-card border-2 bg-surface p-2 hover:bg-hover",
                theme === tile.id ? "border-accent" : "border-border",
              )}
            >
              <span
                className="block h-10 w-full rounded border border-border"
                style={{ background: tile.preview }}
              />
              <span className="flex items-center gap-1 text-xs">
                {tile.icon}
                {tile.label}
              </span>
            </button>
          ))}
        </div>
      </SettingRow>
      <SettingRow label="Accent color" description="Highlights, selections and actions">
        <div className="flex gap-2">
          {ACCENTS.map(([name, value]) => (
            <button
              key={name}
              type="button"
              aria-label={name}
              title={name}
              onClick={() => setAccent(value)}
              className="grid h-7 w-7 place-items-center rounded-full text-white"
              style={{ background: value }}
            >
              {accent.toLowerCase() === value.toLowerCase() && <Check size={14} />}
            </button>
          ))}
        </div>
      </SettingRow>
    </div>
  );
}

export function ModelsPage() {
  const { models, model, setModel, activeConnection, refreshModels, loadingModels, visionFallbackModel, setVisionFallbackModel } = useApp();
  const { options, visionOptions, placeholder, visionPlaceholder } = modelSelectData(models);
  return (
    <div>
      <SettingRow
        label="Default model"
        description={activeConnection ? `From ${activeConnection.name}` : "Add a provider first"}
      >
        <Select
          size="sm"
          value={model || null}
          onChange={(next) => setModel(next)}
          placeholder={placeholder}
          aria-label="Default model"
          disabled={models.length === 0}
          options={options}
        />
      </SettingRow>
      <SettingRow
        label="Vision fallback model"
        description="Reads attached images when the active model cannot"
      >
        <Select
          size="sm"
          value={visionFallbackModel || null}
          onChange={(next) => setVisionFallbackModel(next)}
          placeholder={visionPlaceholder}
          aria-label="Vision fallback model"
          disabled={models.length === 0}
          options={visionOptions}
        />
      </SettingRow>
      <SettingRow label="Refresh models" description="Re-fetch the list from the provider">
        <Button
          variant="default"
          size="sm"
          disabled={!activeConnection || loadingModels}
          onClick={() => void refreshModels()}
        >
          {loadingModels ? "Loading…" : "Refresh"}
        </Button>
      </SettingRow>
    </div>
  );
}

export function MemoryPage() {
  const { loadMemories, addMemory, editMemory, deleteMemory } = useApp();
  const [memories, setMemories] = useState<Memory[]>([]);

  const reload = useCallback(async () => {
    setMemories(await loadMemories("global", null));
  }, [loadMemories]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const clearAll = async () => {
    const confirmed = await confirmDialog({
      title: "Clear all global memory?",
      body: "This cannot be undone.",
      danger: true,
      ok: "Clear all",
    });
    if (!confirmed) return;
    for (const memory of memories) {
      await deleteMemory(memory.id);
    }
    await reload();
  };

  return (
    <div>
      <MemoryEditor
        memories={memories}
        emptyHint="No global memory yet. These notes are sent with every chat."
        onAdd={async (draft) => {
          await addMemory({ scope: "global", project_id: null, ...draft });
          await reload();
        }}
        onUpdate={async (id, draft) => {
          await editMemory(id, draft);
          await reload();
        }}
        onDelete={async (id) => {
          await deleteMemory(id);
          await reload();
        }}
      />
      {memories.length > 0 && (
        <div className="mt-3 flex justify-end">
          <Button variant="danger" size="sm" onClick={() => void clearAll()}>
            Clear all
          </Button>
        </div>
      )}
    </div>
  );
}

export function DataPage() {
  const {
    conversations,
    removeConversation,
    refreshConversations,
    refreshProjects,
    refreshMemories,
    selectConversation,
    selectProject,
    stopStream,
  } = useApp();
  const [stats, setStats] = useState({ conversations: 0, messages: 0, memories: 0, projects: 0 });

  useEffect(() => {
    db.stats()
      .then(setStats)
      .catch(() => undefined);
  }, [conversations]);

  const exportAll = async () => {
    try {
      const allConversations = await db.listConversations();
      const withMessages = await Promise.all(
        allConversations.map(async (c) => ({ ...c, messages: await db.listMessages(c.id) })),
      );
      const allProjects = await db.listProjects();
      const projectMemories = await Promise.all(
        allProjects.map(async (p) => ({ project: p, memories: await db.listMemories("project", p.id) })),
      );
      downloadText(
        `myagent-export-${Date.now()}.json`,
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            conversations: withMessages,
            projects: allProjects,
            globalMemories: await db.listMemories("global", null),
            projectMemories,
          },
          null,
          2,
        ),
        "application/json",
      );
      toast("Data exported");
    } catch (e) {
      toast(errorText(e));
    }
  };

  const clearChats = async () => {
    const confirmed = await confirmDialog({
      title: "Clear all chats?",
      body: "All conversations will be removed. Projects and memory are kept.",
      danger: true,
      ok: "Clear",
    });
    if (!confirmed) return;
    for (const conversation of conversations) {
      await removeConversation(conversation.id);
    }
    toast("Chats cleared");
  };

  const deleteEverything = async () => {
    const confirmed = await confirmDialog({
      title: "Delete everything?",
      body: "All chats, projects and memory will be permanently removed, including files on disk. Connections and stored keys are kept. This cannot be undone.",
      danger: true,
      ok: "Delete everything",
    });
    if (!confirmed) return;
    try {
      stopStream();
      const spillLeftovers: string[] = [];
      for (const conversation of conversations) {
        await api.deleteSpill(conversation.id).catch(() => {
          spillLeftovers.push(conversation.id);
        });
      }
      await db.wipeAll();
      await selectConversation(null);
      selectProject(null);
      await refreshConversations();
      await refreshProjects();
      await refreshMemories();
      toast(
        spillLeftovers.length > 0
          ? "Deleted, but some spill files remain on disk"
          : "Everything deleted",
      );
    } catch (e) {
      toast(errorText(e));
    }
  };

  return (
    <div>
      <SettingRow label="Export all data" description="Download chats, projects and memory as JSON">
        <Button variant="default" size="sm" onClick={() => void exportAll()}>
          Export
        </Button>
      </SettingRow>
      <SettingRow label="Clear all chats" description="Projects and memory are kept">
        <Button variant="danger" size="sm" onClick={() => void clearChats()}>
          Clear
        </Button>
      </SettingRow>
      <SettingRow
        label="Delete everything"
        description="Chats, projects and memory, including files on disk"
      >
        <Button variant="danger" size="sm" onClick={() => void deleteEverything()}>
          Delete
        </Button>
      </SettingRow>
      <div className="mt-4 flex flex-col gap-1.5 px-2">
        <div className="text-xs text-muted">
          {stats.conversations} chats · {stats.messages} messages · {stats.memories} memories ·{" "}
          {stats.projects} projects
        </div>
        <div className="flex">
          <div className="h-1 flex-1 overflow-hidden rounded bg-active">
            <div
              className="h-full bg-accent"
              style={{ width: `${Math.min(100, stats.messages / 10)}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Ctrl+K", "Open command palette"],
  ["Ctrl+N", "New chat"],
  ["Ctrl+,", "Open Settings"],
  ["Ctrl+B", "Toggle sidebar"],
  ["Ctrl+Shift+A", "Toggle artifact panel"],
  ["Enter", "Send message (Shift+Enter for newline)"],
  ["Esc", "Close overlay, else stop streaming"],
  ["/", "Open the slash menu in the composer"],
];

export function ShortcutsPage() {
  return (
    <table className="my-3 w-full border-collapse text-[13px]">
      <tbody>
        {SHORTCUTS.map(([keys, description]) => (
          <tr key={keys}>
            <td className="border-b border-border px-2 py-2">
              {keys.split("+").map((key, i, arr) => (
                <span key={key}>
                  <kbd>{key}</kbd>
                  {i < arr.length - 1 && " + "}
                </span>
              ))}
            </td>
            <td className="border-b border-border px-2 py-2">{description}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function AboutPage() {
  const { setSettingsPage } = useApp();
  const { version, update, checking, progress, status, checkNow, install } = useAppUpdate();

  return (
    <div>
      <SettingRow label="App name" description="">
        <span className="text-sm">MyAgent</span>
      </SettingRow>
      <SettingRow label="Version" description="">
        <span className="text-sm">{version}</span>
      </SettingRow>
      <SettingRow label="Status" description="Local-first BYOK desktop client">
        <span className="text-sm text-success">Ready</span>
      </SettingRow>
      <SettingRow label="Updates" description="Signed releases from GitHub">
        <div className="flex w-full flex-col items-end gap-1.5">
          {update ? (
            <>
              <span className="text-sm">Version {update.version} is ready</span>
              <Button variant="primary" size="sm" disabled={progress !== null} onClick={() => void install()}>
                {progress === null ? "Download & install" : `Installing… ${progress ?? 0}%`}
              </Button>
              {progress !== null && (
                <div className="h-1 w-full overflow-hidden rounded bg-active">
                  <div className="h-full bg-accent" style={{ width: `${progress ?? 0}%` }} />
                </div>
              )}
            </>
          ) : (
            <Button
              variant="default"
              size="sm"
              disabled={checking}
              onClick={() => void checkNow()}
            >
              {checking ? <Spinner label="Checking…" /> : "Check for updates"}
            </Button>
          )}
        </div>
      </SettingRow>
      {status && (
        <p className="px-2 pt-2 text-xs text-muted" role="status">
          {status}
        </p>
      )}
      <SettingRow label="What's new" description="Every release, newest first">
        <Button variant="default" size="sm" onClick={() => setSettingsPage("changelog")}>
          Changelog
        </Button>
      </SettingRow>
      <SettingRow label="Source" description="Issues and contributions welcome">
        <Button
          variant="default"
          size="sm"
          onClick={() => void openUrl("https://github.com/abuAbdur-rahman/myagent")}
        >
          GitHub
        </Button>
      </SettingRow>
    </div>
  );
}
