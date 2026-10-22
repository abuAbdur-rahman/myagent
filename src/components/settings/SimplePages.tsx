import { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronDown,
  Eye,
  EyeOff,
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
import type { VisionOverride } from "../../lib/catalog";
import { applyVisionOverride, type ConnectionModelOption, type VisionFallback } from "../../lib/vision";
import * as api from "../../lib/api";
import { SEARCH_KEY_ACCOUNT } from "../../lib/api";
import * as db from "../../lib/db";
import { MemoryEditor, KindChip } from "../MemoryEditor";
import {
  Badge,
  Button,
  Dialog,
  IconButton,
  Input,
  Pill,
  Segmented,
  Spinner,
  Textarea,
  Toggle,
  type PillTone,
} from "../ui";
import { DropdownMenu, Select, type MenuEntry } from "../ui/select";
import { confirmDialog } from "../ConfirmDialog";
import { downloadText, errorText, copyText } from "../../lib/utils";
import { toast } from "../../lib/toast";
import { timeAgo } from "../../lib/grouping";
import { cn } from "../../lib/utils";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useAppUpdate } from "./useAppUpdate";
import type { AuditLog, Connection, Memory } from "../../lib/types";import { mcpSummary, mcpSummaryText, type McpSummary } from "../../lib/mcp-summary";
import {
  auditCounts,
  auditCsv,
  auditJson,
  auditSummary,
  auditTime,
  auditTools,
  decisionClass,
  filterAudit,
  groupAuditByDay,
  type AuditDecisionFilter,
} from "../../lib/audit";
import { formatBytes } from "../../lib/chat-docs";
import { filterMemories, memoryJson } from "../../lib/memory-export";
import { densityLabel, fontScaleLabel } from "../../lib/appearance";
import {
  buildModelRow,
  contextLabel,
  countHidden,
  filterModelRows,
  visionLabel,
  type ModelTableRow,
} from "../../lib/model-table";
import type { ModelCapabilities } from "../../lib/catalog";
import {
  storageParts,
  storageShares,
  storageTotal,
  type StoragePart,
  type StorageUsage,
} from "../../lib/storage";

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
    <div className="flex items-center justify-between gap-4 border-b border-border px-2 py-3" data-setting-term={label}>
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
  summary,
  reconnecting,
  onReconnectAll,
  onAdd,
}: {
  scope: string;
  summary: McpSummary;
  reconnecting: boolean;
  onReconnectAll: () => void;
  onAdd: () => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 px-2">
      <div className="min-w-0">
        <h3 className="text-sm font-medium">MCP servers</h3>
        <p className="text-xs text-muted">
          {scope} · {mcpSummaryText(summary)}
        </p>
      </div>
      <div className="flex flex-none items-center gap-2">
        <Button
          size="sm"
          variant="default"
          disabled={summary.enabled === 0 || reconnecting}
          onClick={onReconnectAll}
        >
          <RefreshCw size={14} />
          Reconnect all
        </Button>
        <Button variant="primary" size="sm" onClick={onAdd}>
          <Plus size={14} />
          Add server
        </Button>
      </div>
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
  onEdit,
}: {
  id: string;
  error: string;
  onReconnect: (id: string) => void;
  onEdit: () => void;
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
      <button type="button" className="flex-none underline hover:no-underline" onClick={onEdit}>
        Edit
      </button>
    </div>
  );
}

function McpIdentity({
  server,
  probe,
  state,
  onReconnect,
  onEdit,
}: {
  server: api.McpServerRow;
  probe: api.McpProbe | undefined;
  state: McpState;
  onReconnect: (id: string) => void;
  onEdit: () => void;
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
        <McpFailure
          id={server.id}
          error={mcpProbeError(probe)}
          onReconnect={onReconnect}
          onEdit={onEdit}
        />
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
        <McpIdentity
          server={server}
          probe={probe}
          state={state}
          onReconnect={onReconnect}
          onEdit={() => onEdit(server)}
        />
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
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const targetRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(editing ? mcpDraft(editing) : (seed ?? EMPTY_MCP_DRAFT));
    setErrors({});
  }, [open, editing, seed]);

  useEffect(() => {
    setTest(null);
  }, [draft]);

  const probeDraft = async () => {
    const target = mcpDraftTarget(draft).trim();
    if (!target) {
      setTest({ ok: false, text: "Add a command or URL first." });
      return;
    }
    setTesting(true);
    try {
      const probe = await api.mcpTest(
        draft.transport,
        draft.transport === "stdio" ? target : null,
        draft.transport === "sse" ? target : null,
      );
      setTest(
        probe.error
          ? { ok: false, text: probe.error }
          : {
              ok: true,
              text: `Connected · ${probe.tools.length} ${
                probe.tools.length === 1 ? "tool" : "tools"
              }`,
            },
      );
    } catch (e) {
      setTest({ ok: false, text: errorText(e) });
    } finally {
      setTesting(false);
    }
  };

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
      <div className="mt-3 flex items-start gap-2">
        <Button
          size="sm"
          variant="default"
          disabled={testing}
          onClick={() => void probeDraft()}
        >
          {testing ? <Spinner label="Testing" /> : "Test connection"}
        </Button>
        {test && (
          <p className={cn("pt-1.5 text-xs", test.ok ? "text-muted" : "text-danger")} role="status">
            {test.text}
          </p>
        )}
      </div>
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

function AuditEntry({ row }: { row: AuditLog }) {
  const [open, setOpen] = useState(false);
  const kind = decisionClass(row.decision);
  const tone: PillTone =
    kind === "allow" ? "success" : kind === "deny" ? "danger" : kind === "ask" ? "warn" : "neutral";
  return (
    <div className="border-b border-border px-2 py-2">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-left"
      >
        <Pill tone={tone}>{row.decision}</Pill>
        <span className="truncate font-mono text-xs">{row.tool}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-muted">{row.detail}</span>
        <span className="flex-none text-xs tabular-nums text-muted">{auditTime(row.ts)}</span>
        <ChevronDown
          size={14}
          className={cn("flex-none text-muted transition-transform", open && "rotate-180")}
        />
      </button>
      {open && (
        <dl className="mt-2 grid grid-cols-[88px_1fr] gap-x-2 gap-y-1 text-xs">
          <dt className="text-muted">Time</dt>
          <dd>{new Date(row.ts).toLocaleString()}</dd>
          <dt className="text-muted">Chat</dt>
          <dd className="break-all font-mono">{row.conversation_id ?? "global"}</dd>
          <dt className="text-muted">Decision</dt>
          <dd>{row.decision}</dd>
          {row.detail && (
            <>
              <dt className="text-muted">Detail</dt>
              <dd className="whitespace-pre-wrap break-words">{row.detail}</dd>
            </>
          )}
        </dl>
      )}
    </div>
  );
}

function auditEmptyText(search: string): string {
  return search.trim() ? "No matching audit entries." : "No approval decisions recorded yet.";
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
    standingPrompt,
    setStandingPrompt,
    showContextBar,
    setShowContextBar,
  } = useApp();
  const [draft, setDraft] = useState(standingPrompt);
  const [saved, setSaved] = useState(standingPrompt);

  useEffect(() => {
    setDraft(standingPrompt);
    setSaved(standingPrompt);
  }, [standingPrompt]);

  const dirty = draft !== saved;

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
      <SettingRow
        label="Context bar"
        description="Show the used-tokens bar above the composer"
      >
        <Toggle
          checked={showContextBar}
          onChange={setShowContextBar}
          label="Show the context bar"
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

      <div
        className="mt-4 rounded-card border border-border p-3"
        data-setting-term="Standing instructions"
      >
        <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
          <span className="text-xs font-medium">Standing instructions</span>
          <span className="text-xs text-muted">
            {draft.trim() ? `${Array.from(draft.trim()).length} characters` : "Empty"}
          </span>
        </div>
        <p className="mb-2 text-xs text-muted">
          Sent with every chat, after the app's own rules and before the project block. A chat
          can override this from its ••• menu.
        </p>
        <Textarea
          rows={5}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="e.g. Answer in TypeScript. Keep replies under 200 words."
          aria-label="Standing instructions"
        />
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="text-xs text-muted">
            {dirty ? "Unsaved changes" : saved ? "Saved on this device" : "Nothing saved"}
          </span>
          <div className="flex gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={!draft && !saved}
              onClick={() => {
                setDraft("");
                setStandingPrompt("");
              }}
            >
              Clear
            </Button>
            <Button size="sm" disabled={!dirty} onClick={() => setStandingPrompt(draft)}>
              Save
            </Button>
          </div>
        </div>
      </div>
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

  const summary = mcpSummary(servers, probes);
  const reconnecting = Object.values(probing).some(Boolean);

  return (
    <div className="flex flex-col gap-3 pb-2">
      <McpPageHeader
        scope={mcpScope(activeProject)}
        summary={summary}
        reconnecting={reconnecting}
        onReconnectAll={() => {
          for (const server of servers) {
            if (server.enabled) reconnect(server.id);
          }
        }}
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
  const [decision, setDecision] = useState<AuditDecisionFilter>("all");
  const [tool, setTool] = useState<string | null>(null);
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

  const copy = async (text: string, message: string) => {
    const ok = await copyText(text);
    if (ok) toast(message);
    else setStatus("Clipboard is not available.");
  };

  const exportItems = (rows: AuditLog[]): MenuEntry[] => [
    { id: "copy-csv", label: "Copy as CSV", onSelect: () => void copy(auditCsv(rows), "CSV copied") },
    {
      id: "copy-json",
      label: "Copy as JSON",
      onSelect: () => void copy(auditJson(rows), "JSON copied"),
    },
    { id: "separator", type: "separator" },
    {
      id: "download-csv",
      label: "Download CSV",
      onSelect: () => downloadText("audit-log.csv", auditCsv(rows), "text/csv"),
    },
    {
      id: "download-json",
      label: "Download JSON",
      onSelect: () => downloadText("audit-log.json", auditJson(rows), "application/json"),
    },
  ];

  const tools = auditTools(rows);
  const visible = filterAudit(rows, decision, tool);
  const counts = auditCounts(visible);
  const groups = groupAuditByDay(visible, new Date());

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
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-2 py-2">
        <Segmented<AuditDecisionFilter>
          value={decision}
          onChange={setDecision}
          label="Filter by decision"
          options={[
            { value: "all", label: "All" },
            { value: "allow", label: "Allowed" },
            { value: "ask", label: "Asked" },
            { value: "deny", label: "Denied" },
            { value: "other", label: "Other" },
          ]}
        />
        <Select
          size="sm"
          value={tool ?? ""}
          onChange={(value) => setTool(value === "" ? null : value)}
          aria-label="Filter by tool"
          options={[
            { value: "", label: "All tools" },
            ...tools.map((entry) => ({
              value: entry.name,
              label: `${entry.name} (${entry.count})`,
            })),
          ]}
        />
        <span className="ml-auto text-xs text-muted">{auditSummary(counts)}</span>
        <DropdownMenu
          align="end"
          aria-label="Export audit log"
          items={exportItems(visible)}
          trigger={
            <Button size="sm" variant="default" disabled={visible.length === 0}>
              Export
            </Button>
          }
        />
      </div>
      {loaded && groups.length === 0 && (
        <p className="px-2 py-3 text-xs text-muted">{auditEmptyText(search)}</p>
      )}
      {groups.map((group) => (
        <section key={group.key}>
          <h4 className="px-2 pb-1 pt-3 text-xs font-medium text-muted">{group.label}</h4>
          {group.rows.map((row) => (
            <AuditEntry key={row.id} row={row} />
          ))}
        </section>
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

export function SearchPage() {
  const { searchBackend, setSearchBackend, searchEndpoint, setSearchEndpoint } = useApp();
  const [key, setKey] = useState("");
  const [keys, setKeys] = useState<api.SearchKeyInfo[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [testing, setTesting] = useState<number | null>(null);
  const [probes, setProbes] = useState<Record<number, { ok: boolean; text: string }>>({});
  const [stats, setStats] = useState<api.SearchKeyStat[]>([]);
  const [endpointTest, setEndpointTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [testingEndpoint, setTestingEndpoint] = useState(false);
  const [exaKey, setExaKey] = useState("");
  const [exaHint, setExaHint] = useState<string | null>(null);
  const [exaTest, setExaTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [testingExa, setTestingExa] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [list, counts, hint] = await Promise.all([
        api.searchKeyList(),
        api.searchKeyStats(),
        api.exaKeyHint(),
      ]);
      setKeys(list);
      setStats(counts);
      setExaHint(hint);
      setProbes({});
    } catch (e) {
      setStatus(errorText(e));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const save = async () => {
    if (!key.trim()) {
      setStatus("Enter a Tavily API key.");
      return;
    }
    try {
      await api.addSearchKey(key.trim());
      setKey("");
      await reload();
      setStatus("Search key saved.");
    } catch (e) {
      setStatus(errorText(e));
    }
  };

  const removeOne = async (index: number) => {
    try {
      await api.removeSearchKey(index);
      await reload();
      setStatus("Key removed.");
    } catch (e) {
      setStatus(errorText(e));
    }
  };

  const clear = async () => {
    try {
      await api.deleteApiKey(SEARCH_KEY_ACCOUNT);
      await reload();
      setStatus("Search keys removed.");
    } catch (e) {
      setStatus(errorText(e));
    }
  };

  const probe = async (index: number) => {
    setTesting(index);
    try {
      const message = await api.searchKeyTest(index);
      setProbes((prev) => ({ ...prev, [index]: { ok: true, text: message } }));
    } catch (e) {
      setProbes((prev) => ({ ...prev, [index]: { ok: false, text: errorText(e) } }));
    } finally {
      setTesting(null);
      api
        .searchKeyStats()
        .then(setStats)
        .catch((e) => setStatus(errorText(e)));
    }
  };

  const testEndpoint = async () => {
    setTestingEndpoint(true);
    try {
      setEndpointTest({ ok: true, text: await api.searchEndpointTest(searchEndpoint) });
    } catch (e) {
      setEndpointTest({ ok: false, text: errorText(e) });
    } finally {
      setTestingEndpoint(false);
    }
  };

  const saveExa = async () => {
    try {
      await api.saveExaKey(exaKey.trim());
      setExaKey("");
      setExaTest(null);
      await reload();
      setStatus("Exa key saved.");
    } catch (e) {
      setStatus(errorText(e));
    }
  };

  const clearExa = async () => {
    try {
      await api.saveExaKey("");
      setExaTest(null);
      await reload();
      setStatus("Exa key removed.");
    } catch (e) {
      setStatus(errorText(e));
    }
  };

  const testExa = async () => {
    setTestingExa(true);
    try {
      setExaTest({ ok: true, text: await api.exaKeyTest() });
    } catch (e) {
      setExaTest({ ok: false, text: errorText(e) });
    } finally {
      setTestingExa(false);
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
            keys.length > 0
              ? `${keys.length} key${keys.length === 1 ? "" : "s"} stored — rotates on quota`
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
          {keys.length > 0 && (
            <Button variant="danger" onClick={() => void clear()}>
              Remove all
            </Button>
          )}
        </SettingRow>
      )}
      {searchBackend === "tavily" && keys.length > 0 && (
        <div className="mt-1" data-setting-term="Stored keys">
          <p className="px-2 py-2 text-xs text-muted">
            First key is tried first. Counts reset when the app restarts.
          </p>
          {keys.map((entry) => {
            const result = probes[entry.index];
            const stat = stats[entry.index];
            return (
              <div
                key={entry.index}
                className="flex items-center gap-2 border-b border-border px-2 py-2 text-xs"
              >
                <span className="font-medium">Key {entry.index + 1}</span>
                <span className="font-mono text-muted">{entry.hint}</span>
                {stat && stat.requests > 0 && (
                  <span className="text-muted">
                    {stat.requests} search{stat.requests === 1 ? "" : "es"}
                  </span>
                )}
                {stat && stat.quota_hits > 0 && (
                  <span className="rounded-full border border-warn px-1.5 py-0.5 text-warn">
                    quota hit ×{stat.quota_hits}
                  </span>
                )}
                <span className="flex-1" />
                {result && (
                  <span className={cn(result.ok ? "text-muted" : "text-warn")}>{result.text}</span>
                )}
                <Button
                  size="sm"
                  variant="default"
                  disabled={testing !== null}
                  onClick={() => void probe(entry.index)}
                >
                  {testing === entry.index ? <Spinner label="Testing" /> : "Test"}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={testing !== null}
                  onClick={() => void removeOne(entry.index)}
                >
                  Remove
                </Button>
              </div>
            );
          })}
        </div>
      )}
      {searchBackend === "tavily" && (
        <SettingRow
          label="Exa fallback key"
          description={
            exaHint
              ? `Stored (${exaHint}) — used only when Tavily answers quota`
              : "Optional. Used only when Tavily answers quota"
          }
        >
          <Input
            type="password"
            value={exaKey}
            onChange={(e) => setExaKey(e.target.value)}
            placeholder="exa-…"
            aria-label="Exa API key"
            autoComplete="off"
          />
          <Button variant="primary" disabled={!exaKey.trim()} onClick={() => void saveExa()}>
            Save key
          </Button>
          {exaHint && (
            <Button size="sm" variant="default" disabled={testingExa} onClick={() => void testExa()}>
              {testingExa ? <Spinner label="Testing" /> : "Test"}
            </Button>
          )}
          {exaHint && (
            <Button size="sm" variant="ghost" onClick={() => void clearExa()}>
              Remove
            </Button>
          )}
        </SettingRow>
      )}
      {searchBackend === "tavily" && exaTest && (
        <p
          className={cn("px-2 py-2 text-xs", exaTest.ok ? "text-muted" : "text-warn")}
          role="status"
        >
          {exaTest.text}
        </p>
      )}
      {searchBackend === "searxng" && (
        <SettingRow label="SearXNG endpoint" description="Local instance that returns format=json">          <Input
            value={searchEndpoint}
            onChange={(e) => {
              setSearchEndpoint(e.target.value);
              setEndpointTest(null);
            }}
            placeholder="http://127.0.0.1:8888"
            aria-label="SearXNG endpoint"
          />
          <Button
            size="sm"
            variant="default"
            disabled={testingEndpoint}
            onClick={() => void testEndpoint()}
          >
            {testingEndpoint ? <Spinner label="Testing" /> : "Test"}
          </Button>
        </SettingRow>
      )}
      {searchBackend === "searxng" && endpointTest && (
        <p
          className={cn("px-2 py-2 text-xs", endpointTest.ok ? "text-muted" : "text-warn")}
          role="status"
        >
          {endpointTest.text}
        </p>
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
  const {
    theme,
    setTheme,
    accent,
    setAccent,
    fontScale,
    setFontScale,
    density,
    setDensity,
    groupByDate,
    setGroupByDate,
  } = useApp();
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
      <SettingRow
        label="Text size"
        description="Scales text and spacing together, so nothing clips"
      >
        <div className="flex items-center gap-2.5" data-setting-term="Text size">
          <span className="text-xs text-muted" aria-hidden="true">
            A
          </span>
          <input
            type="range"
            min={0.9}
            max={1.2}
            step={0.05}
            value={fontScale}
            onChange={(event) => setFontScale(Number(event.target.value))}
            aria-label="Text size"
            aria-valuetext={fontScaleLabel(fontScale)}
            className="h-4 w-40 cursor-pointer accent-[var(--accent)]"
          />
          <span className="text-base text-muted" aria-hidden="true">
            A
          </span>
          <span className="w-12 text-right text-xs tabular-nums text-muted">
            {fontScaleLabel(fontScale)}
          </span>
        </div>
      </SettingRow>
      <SettingRow label="Density" description="Row height in the sidebar and the gap between messages">
        <Select
          size="sm"
          value={density}
          onChange={(value) => setDensity(value === "compact" ? "compact" : "comfortable")}
          aria-label="Density"
          options={[
            { value: "comfortable", label: densityLabel("comfortable") },
            { value: "compact", label: densityLabel("compact") },
          ]}
        />
      </SettingRow>
      <SettingRow label="Group chats by date" description="Today, Yesterday, Previous 7 days, Older">
        <Toggle checked={groupByDate} onChange={setGroupByDate} label="Group chats by date" />
      </SettingRow>
    </div>
  );
}

const VISION_OVERRIDE_OPTIONS = [
  { value: "auto", label: "Detect automatically" },
  { value: "yes", label: "Can see images" },
  { value: "no", label: "Cannot see images" },
];

type ModelOption = { value: string; label: string; group?: string };

function modelOptionsFrom(rows: ConnectionModelOption[]): ModelOption[] {
  return rows.map((option) => ({
    value: `${option.connectionId}/${option.modelId}`,
    label: option.modelId,
    group: option.connectionName,
  }));
}

function visionModelOptions(
  rows: ConnectionModelOption[],
  override: (connectionId: string, modelId: string) => VisionOverride,
): ModelOption[] {
  return [
    { value: "", label: "None (send text only)" },
    ...modelOptionsFrom(
      rows.filter((option) =>
        applyVisionOverride(option.seesImages, override(option.connectionId, option.modelId)),
      ),
    ),
  ];
}

function keepSelected(
  options: ModelOption[],
  selected: string | null,
  label: string,
): ModelOption[] {
  if (!selected || options.some((option) => option.value === selected)) return options;
  return [...options, { value: selected, label: `${label} (now unavailable)` }];
}

function splitModelValue(value: string): { connectionId: string; modelId: string } {
  const slash = value.indexOf("/");
  return { connectionId: value.slice(0, slash), modelId: value.slice(slash + 1) };
}

function defaultModelDescription(connection: Connection | null): string {
  return connection ? `Used in new chats · ${connection.name}` : "Add a provider first";
}

function imageReadingDescription(
  model: string,
  connectionId: string | null,
  seesImages: boolean,
  hasFallback: boolean,
): string {
  if (!model || !connectionId) return "Select a model first";
  if (seesImages) return "This model receives images directly";
  return hasFallback
    ? "This model cannot read images; the vision fallback reads them"
    : "This model cannot read images; images are dropped until a fallback is set";
}

function modelValue(connectionId: string | null, model: string): string | null {
  return connectionId && model ? `${connectionId}/${model}` : null;
}

function fallbackValue(
  fallback: VisionFallback | null,
  activeConnectionId: string | null,
): string | null {
  if (!fallback) return null;
  return `${fallback.connectionId || activeConnectionId || ""}/${fallback.model}`;
}

function overrideValue(override: VisionOverride): string {
  return override ?? "auto";
}

function overrideFromPick(next: string): VisionOverride {
  if (next === "yes" || next === "no") return next;
  return null;
}

function canPickModelValue(connectionId: string | null, model: string): boolean {
  return connectionId !== null && model.length > 0;
}

function seesImagesFor(
  canSeeImages: (connectionId: string, model: string) => boolean,
  connectionId: string | null,
  model: string,
): boolean {
  if (!connectionId || !model) return false;
  return canSeeImages(connectionId, model);
}

function useAllModelOptions() {
  const { loadAllModelOptions } = useApp();
  const [all, setAll] = useState<ConnectionModelOption[] | null>(null);
  const [loading, setLoading] = useState(false);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setAll(await loadAllModelOptions());
    } catch (cause) {
      toast(errorText(cause));
    } finally {
      setLoading(false);
    }
  }, [loadAllModelOptions]);
  useEffect(() => {
    void reload();
  }, [reload]);
  return { rows: all ?? [], loading, reload };
}

function DefaultModelRow({
  rows,
  loading,
  connection,
  model,
}: {
  rows: ConnectionModelOption[];
  loading: boolean;
  connection: Connection | null;
  model: string;
}) {
  const { activeConnectionId, selectConnection, setModel } = useApp();
  const options = modelOptionsFrom(rows);
  const pick = (value: string) => {
    const picked = splitModelValue(value);
    if (picked.connectionId !== activeConnectionId) selectConnection(picked.connectionId);
    setModel(picked.modelId);
  };
  return (
    <SettingRow label="Default model" description={defaultModelDescription(connection)}>
      <Select
        size="sm"
        value={modelValue(activeConnectionId, model)}
        onChange={pick}
        placeholder="Select a model"
        aria-label="Default model"
        disabled={options.length === 0}
        loading={loading}
        options={options}
      />
    </SettingRow>
  );
}

function ImageReadingRow() {
  const { model, activeConnectionId, canSeeImages, modelVisionOverride, setModelVisionOverride, visionFallback } =
    useApp();
  const override = activeConnectionId ? modelVisionOverride(activeConnectionId, model) : null;
  const pick = (value: string) => {
    if (activeConnectionId) {
      setModelVisionOverride(activeConnectionId, model, overrideFromPick(value));
    }
  };
  return (
    <SettingRow
      label="Image reading"
      description={imageReadingDescription(
        model,
        activeConnectionId,
        seesImagesFor(canSeeImages, activeConnectionId, model),
        visionFallback !== null,
      )}
    >
      <Select
        size="sm"
        value={overrideValue(override)}
        onChange={pick}
        aria-label="Image reading"
        disabled={!canPickModelValue(activeConnectionId, model)}
        options={VISION_OVERRIDE_OPTIONS}
      />
    </SettingRow>
  );
}

function VisionFallbackRow({
  rows,
  loading,
  fallback,
  activeConnectionId,
  onPick,
}: {
  rows: ConnectionModelOption[];
  loading: boolean;
  fallback: VisionFallback | null;
  activeConnectionId: string | null;
  onPick: (value: VisionFallback | null) => void;
}) {
  const { modelVisionOverride } = useApp();
  const selected = fallbackValue(fallback, activeConnectionId);
  const options = keepSelected(
    visionModelOptions(rows, modelVisionOverride),
    selected,
    fallback?.model ?? "",
  );
  const pick = (value: string) => {
    if (!value) {
      onPick(null);
      return;
    }
    const picked = splitModelValue(value);
    onPick({ connectionId: picked.connectionId, model: picked.modelId });
  };
  return (
    <SettingRow
      label="Vision fallback model"
      description="Reads attached images when the active model cannot. Only models that can see images are listed."
    >
      <Select
        size="sm"
        value={selected}
        onChange={pick}
        placeholder="None"
        aria-label="Vision fallback model"
        disabled={options.length <= 1 && fallback === null}
        loading={loading}
        options={options}
      />
    </SettingRow>
  );
}

export function ModelsPage() {
  const {
    model,
    activeConnection,
    activeConnectionId,
    refreshModels,
    loadingModels,
    visionFallback,
    setVisionFallback,
  } = useApp();
  const { rows, loading, reload } = useAllModelOptions();
  const busy = loading || loadingModels;

  return (
    <div>
      <DefaultModelRow
        rows={rows}
        loading={busy}
        connection={activeConnection}
        model={model}
      />
      <ImageReadingRow />
      <VisionFallbackRow
        rows={rows}
        loading={loading}
        fallback={visionFallback}
        activeConnectionId={activeConnectionId}
        onPick={setVisionFallback}
      />
      <ModelCapabilityTable
        activeConnectionId={activeConnectionId}
        busy={busy}
        onRefresh={async () => {
          await refreshModels();
          await reload();
        }}
      />
    </div>
  );
}

function ModelCapabilityTable({
  activeConnectionId,
  busy,
  onRefresh,
}: {
  activeConnectionId: string | null;
  busy: boolean;
  onRefresh: () => Promise<void>;
}) {
  const {
    connections,
    modelVisionOverride,
    setModelVisionOverride,
    toggleModelVisibility,
  } = useApp();
  const [connectionId, setConnectionId] = useState(
    activeConnectionId ?? connections[0]?.id ?? "",
  );
  const [data, setData] = useState<{
    ids: string[];
    caps: ModelCapabilities[];
    hidden: Set<string>;
  } | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const connection = connections.find((item) => item.id === connectionId) ?? null;

  useEffect(() => {
    if (!connection) {
      setData({ ids: [], caps: [], hidden: new Set() });
      return;
    }
    let live = true;
    setStatus(null);
    setData(null);
    Promise.all([
      api.listModels(connection.id, connection.kind),
      api.listModelCaps(connection.id, connection.kind),
      db.listHiddenModels(connection.id),
    ])
      .then(([ids, caps, hidden]) => {
        if (live) setData({ ids, caps, hidden: new Set(hidden) });
      })
      .catch((e) => {
        if (live) {
          setData({ ids: [], caps: [], hidden: new Set() });
          setStatus(errorText(e));
        }
      });
    return () => {
      live = false;
    };
  }, [connection]);

  const rows = (data?.ids ?? []).map((id) =>
    buildModelRow({
      connectionId: connection?.id ?? "",
      connectionName: connection?.name ?? "",
      kind: connection?.kind ?? "custom",
      modelId: id,
      caps: data?.caps ?? null,
      hidden: data?.hidden.has(id) ?? false,
      override: modelVisionOverride(connection?.id ?? null, id),
    }),
  );
  const visible = filterModelRows(rows, query);

  const setOverride = (row: ModelTableRow, value: string) => {
    const override = value === "auto" ? null : (value as VisionOverride);
    setModelVisionOverride(row.connectionId, row.modelId, override);
  };

  const toggleHidden = async (row: ModelTableRow) => {
    setBusyId(row.key);
    try {
      await toggleModelVisibility(row.connectionId, row.modelId, !row.hidden);
      setData((prev) => {
        if (!prev) return prev;
        const hidden = new Set(prev.hidden);
        if (row.hidden) hidden.delete(row.modelId);
        else hidden.add(row.modelId);
        return { ...prev, hidden };
      });
    } catch (e) {
      setStatus(errorText(e));
    } finally {
      setBusyId(null);
    }
  };

  const refresh = async () => {
    setRefreshing(true);
    try {
      await onRefresh();
      if (connection) {
        const [ids, caps, hidden] = await Promise.all([
          api.listModels(connection.id, connection.kind),
          api.listModelCaps(connection.id, connection.kind),
          db.listHiddenModels(connection.id),
        ]);
        setData({ ids, caps, hidden: new Set(hidden) });
        setStatus(null);
      }
    } catch (e) {
      setStatus(errorText(e));
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="mt-4" data-setting-term="Model capabilities">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium">Model capabilities</span>
        <span className="text-xs text-muted">
          {data ? `${visible.length} of ${rows.length}` : "Loading…"}
          {data && countHidden(rows) > 0 ? ` · ${countHidden(rows)} hidden` : ""}
        </span>
        <Select
          size="sm"
          className="w-44"
          value={connectionId}
          onChange={setConnectionId}
          aria-label="Provider"
          options={connections.map((item) => ({ value: item.id, label: item.name }))}
        />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter models"
          aria-label="Filter models"
          className="h-7 w-40 text-xs"
        />
        <Button
          variant="ghost"
          size="sm"
          className="ml-auto"
          disabled={busy || refreshing}
          onClick={() => void refresh()}
        >
          <RefreshCw size={14} /> {refreshing || busy ? "Refreshing…" : "Refresh"}
        </Button>
      </div>

      {status && (
        <p className="mb-2 text-xs text-danger" role="status">
          {status}
        </p>
      )}

      {connections.length === 0 && (
        <p className="text-xs text-muted">Add a provider to see what its models report.</p>
      )}

      {connections.length > 0 && data && rows.length === 0 && !status && (
        <p className="text-xs text-muted">
          This provider listed no models. Test it on the Providers page.
        </p>
      )}

      {rows.length > 0 && (
        <div className="overflow-hidden rounded-card border border-border">
          <div className="grid grid-cols-[1fr_72px_120px_64px_36px] items-center gap-2 border-b border-border bg-surface-2/40 px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">
            <span>Model</span>
            <span>Context</span>
            <span>Vision</span>
            <span>Tools</span>
            <span className="sr-only">Visible</span>
          </div>
          {visible.map((row) => (
            <div
              key={row.key}
              className="grid grid-cols-[1fr_72px_120px_64px_36px] items-center gap-2 border-b border-border/60 px-3 py-1.5 last:border-b-0"
            >
              <span
                className={cn(
                  "truncate font-mono text-xs",
                  row.hidden && "text-muted line-through",
                )}
                title={row.modelId}
              >
                {row.modelId}
              </span>
              <span
                className={cn("text-xs", row.context === null ? "text-muted" : "tabular-nums")}
                title={row.context === null ? "The provider did not report a context window" : undefined}
              >
                {contextLabel(row.context)}
              </span>
              <Select
                size="sm"
                value={row.override ?? "auto"}
                onChange={(value) => setOverride(row, value)}
                aria-label={`Vision for ${row.modelId}`}
                options={[
                  { value: "auto", label: `Auto (${visionLabel(row.catalogVision)})` },
                  { value: "yes", label: "Force on" },
                  { value: "no", label: "Force off" },
                ]}
              />
              <Pill tone={row.tools ? "neutral" : "danger"}>{row.tools ? "Yes" : "No"}</Pill>
              <Button
                variant="ghost"
                size="icon"
                aria-label={row.hidden ? `Show ${row.modelId}` : `Hide ${row.modelId}`}
                title={row.hidden ? "Show in the picker" : "Hide from the picker"}
                disabled={busyId === row.key}
                onClick={() => void toggleHidden(row)}
              >
                {row.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
              </Button>
            </div>
          ))}
          {visible.length === 0 && (
            <p className="px-3 py-3 text-xs text-muted">No model matches “{query.trim()}”.</p>
          )}
        </div>
      )}
      <p className="mt-2 text-xs text-muted">
        Context and tools come from the provider. “Unknown” means it never said; it is not a
        guess. A vision override wins over the catalog and is stored on this device.
      </p>
    </div>
  );
}

export function MemoryPage() {
  const {
    loadMemories,
    addMemory,
    editMemory,
    deleteMemory,
    pendingMemories,
    approvePendingMemory,
    dismissPendingMemory,
    undoApprovedMemory,
    conversations,
  } = useApp();
  const [memories, setMemories] = useState<Memory[]>([]);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const reload = useCallback(async () => {
    setMemories(await loadMemories("global", null));
  }, [loadMemories]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const chatName = (conversationId: string | null) => {
    if (!conversationId) return null;
    return conversations.find((item) => item.id === conversationId)?.title ?? null;
  };

  const chatLabel = (conversationId: string | null) => {
    const name = chatName(conversationId);
    return name ? `from "${name}"` : "from a chat";
  };

  const visible = filterMemories(memories, query);

  const memoryMeta = (memory: Memory) => {
    const name = chatName(memory.source_conversation_id ?? null);
    const source = name ? `from "${name}"` : "Added by you";
    const scope = memory.scope === "global" ? "Every chat" : "This project";
    return `${scope} · ${source} · ${timeAgo(memory.created_at)}`;
  };

  const exportJson = () => memoryJson(memories, pendingMemories, chatName);

  const copyExport = async () => {
    const ok = await copyText(exportJson());
    if (ok) toast("Memory copied as JSON");
    else setActionError("Clipboard is not available.");
  };

  const approve = async (id: string) => {
    setBusyId(id);
    try {
      await approvePendingMemory(id);
      await reload();
      setActionError(null);
      toast("Memory saved", {
        actions: [
          {
            label: "Undo",
            run: () => {
              void undoApprovedMemory(id).then(reload);
            },
          },
        ],
      });
    } catch (e) {
      setActionError(errorText(e));
    } finally {
      setBusyId(null);
    }
  };

  const dismiss = async (id: string) => {
    setBusyId(id);
    try {
      await dismissPendingMemory(id);
      setActionError(null);
    } catch (e) {
      setActionError(errorText(e));
    } finally {
      setBusyId(null);
    }
  };

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
      {pendingMemories.length > 0 && (
        <div
          className="mb-3 rounded-control border border-warn/40 p-3"
          data-setting-term="Pending memory"
        >
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-xs font-medium">
              {pendingMemories.length} {pendingMemories.length === 1 ? "memory" : "memories"}{" "}
              waiting for review
            </span>
            <span className="text-xs text-text-muted">
              Nothing is stored until you save it.
            </span>
          </div>
          <div className="space-y-1.5">
            {pendingMemories.map((item) => (
              <div
                key={item.id}
                className="rounded-control border border-vault-line px-3 py-2"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <KindChip kind={item.kind} />
                      <span className="text-xs text-text-faint">
                        {item.scope === "global" ? "Every chat" : "This project"} ·{" "}
                        {chatLabel(item.conversation_id)} · {timeAgo(item.created_at)}
                      </span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-text-primary">
                      {item.content}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void dismiss(item.id)}
                      disabled={busyId !== null}
                    >
                      Dismiss
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => void approve(item.id)}
                      disabled={busyId !== null}
                    >
                      Save
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {actionError && (
            <p className="mt-2 text-xs text-alarm" role="alert">
              {actionError}
            </p>
          )}
        </div>
      )}
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium">Saved memory</span>
        <span className="text-xs text-text-muted">
          {visible.length === memories.length
            ? `${memories.length} ${memories.length === 1 ? "note" : "notes"}`
            : `${visible.length} of ${memories.length}`}
        </span>
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search memory"
          aria-label="Search memory"
          className="ml-auto h-7 w-44 text-xs"
        />
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void copyExport()}
          disabled={memories.length === 0 && pendingMemories.length === 0}
        >
          Copy JSON
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => downloadText("memory.json", exportJson(), "application/json")}
          disabled={memories.length === 0 && pendingMemories.length === 0}
        >
          Download
        </Button>
      </div>
      <MemoryEditor
        memories={visible}
        emptyHint={
          query.trim()
            ? `Nothing matches "${query.trim()}".`
            : "No global memory yet. These notes are sent with every chat."
        }
        meta={(memory) => memoryMeta(memory)}
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
  const [usage, setUsage] = useState<StorageUsage | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [counts, sizes] = await Promise.all([db.stats(), api.storageUsage()]);
      setStats(counts);
      setUsage(sizes);
      setUsageError(null);
    } catch (e) {
      setUsageError(errorText(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, conversations]);

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
    await refresh();
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
      await refresh();
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
      <div className="mt-4 flex flex-col gap-2 px-2" data-setting-term="Storage">
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-xs">
          <span className="font-medium">Storage on disk</span>
          <span className="text-muted">
            {stats.conversations} chats · {stats.messages} messages · {stats.memories} memories ·{" "}
            {stats.projects} projects
          </span>
        </div>
        {usage && <StorageBar usage={usage} />}
        {usageError && (
          <p className="text-xs text-danger" role="status">
            {usageError}
          </p>
        )}
      </div>
    </div>
  );
}

function StorageBar({ usage }: { usage: StorageUsage }) {
  const parts = storageParts(usage);
  const shares = storageShares(parts);
  const total = storageTotal(usage);
  const tones: Record<StoragePart["key"], string> = {
    db: "bg-accent",
    documents: "bg-success",
    spill: "bg-warn",
  };
  return (
    <>
      <div
        className="flex h-1.5 overflow-hidden rounded-full bg-active"
        role="img"
        aria-label={`Storage: ${parts
          .map((part) => `${part.label} ${formatBytes(part.bytes)}`)
          .join(", ")}`}
      >
        {shares.map(({ part, pct }) =>
          pct > 0 ? (
            <div key={part.key} className={tones[part.key]} style={{ width: `${pct}%` }} />
          ) : null,
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        {parts.map((part) => (
          <span key={part.key} className="inline-flex items-center gap-1.5">
            <span className={cn("h-2 w-2 rounded-full", tones[part.key])} aria-hidden="true" />
            {part.label} {formatBytes(part.bytes)}
          </span>
        ))}
        <span className="ml-auto tabular-nums">
          {formatBytes(total)} in {usage.files} {usage.files === 1 ? "file" : "files"} on disk
        </span>
      </div>
    </>
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
