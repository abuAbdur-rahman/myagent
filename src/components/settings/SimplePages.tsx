import { useCallback, useEffect, useState } from "react";
import { Check, Moon, Sun, Monitor } from "lucide-react";
import { useApp, type ThemeMode } from "../../lib/store";
import * as api from "../../lib/api";
import { SEARCH_KEY_ACCOUNT } from "../../lib/api";
import * as db from "../../lib/db";
import { MemoryEditor } from "../MemoryEditor";
import { Button, Input, Spinner, Toggle } from "../ui";
import { Select } from "../ui/select";
import { confirmDialog } from "../ConfirmDialog";
import { downloadText, errorText } from "../../lib/utils";
import { toast } from "../../lib/toast";
import { cn } from "../../lib/utils";
import { openUrl } from "@tauri-apps/plugin-opener";
import { check } from "@tauri-apps/plugin-updater";
import {
  channelMessage,
  getAppVersion,
  installUpdate,
  type Update,
} from "../../lib/updater";
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
  const projectId = activeProject?.id ?? null;
  const [servers, setServers] = useState<api.McpServerRow[]>([]);
  const [name, setName] = useState("");
  const [transport, setTransport] = useState("stdio");
  const [target, setTarget] = useState("");
  const [status, setStatus] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setServers(await api.mcpList(projectId));
    } catch (e) {
      setStatus(errorText(e));
    }
  }, [projectId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const add = async () => {
    if (!name.trim() || !target.trim()) {
      setStatus("Name and command/URL are required.");
      return;
    }
    try {
      await api.mcpAdd(
        projectId,
        name.trim(),
        transport,
        transport === "stdio" ? target.trim() : null,
        transport === "sse" ? target.trim() : null,
      );
      setName("");
      setTarget("");
      setStatus("Server added. It connects on the next send.");
      await reload();
    } catch (e) {
      setStatus(errorText(e));
    }
  };

  const toggle = async (id: string, enabled: boolean) => {
    try {
      await api.mcpToggle(id, enabled);
      await reload();
    } catch (e) {
      setStatus(errorText(e));
    }
  };

  const remove = async (id: string) => {
    try {
      await api.mcpRemove(id);
      await reload();
    } catch (e) {
      setStatus(errorText(e));
    }
  };

  return (
    <div>
      <SettingRow
        label="Scope"
        description={activeProject ? `Project: ${activeProject.name}` : "Global (all chats)"}
      >
        <span className="text-sm text-muted">
          {servers.length} server{servers.length === 1 ? "" : "s"}
        </span>
      </SettingRow>
      {servers.map((server) => (
        <SettingRow
          key={server.id}
          label={server.name}
          description={`${server.transport} · ${server.transport === "stdio" ? (server.cmd ?? "") : (server.url ?? "")}`}
        >
          <Toggle
            checked={server.enabled}
            onChange={(next) => void toggle(server.id, next)}
            label={`Enable ${server.name}`}
          />
          <Button variant="danger" size="sm" onClick={() => void remove(server.id)}>
            Remove
          </Button>
        </SettingRow>
      ))}
      <SettingRow label="New server" description="stdio needs a command; sse needs an http(s) URL">
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="fs"
          aria-label="Server name"
          autoComplete="off"
        />
      </SettingRow>
      <SettingRow label="Transport" description="How MyAgent reaches the server">
        <Select
          size="sm"
          value={transport}
          onChange={setTransport}
          aria-label="Transport"
          options={[
            { value: "stdio", label: "stdio" },
            { value: "sse", label: "sse" },
          ]}
        />
        <Input
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          placeholder={transport === "stdio" ? "npx my-server" : "https://host:8000/sse"}
          aria-label={transport === "stdio" ? "Command" : "URL"}
          autoComplete="off"
        />
        <Button variant="primary" size="sm" onClick={() => void add()}>
          Add
        </Button>
      </SettingRow>
      {status && (
        <p className="px-2 py-2 text-xs text-muted" role="status">
          {status}
        </p>
      )}
      <p className="px-2 py-2 text-xs text-muted">
        Every MCP tool call asks first unless you allow it. Per-tool Always lives on the approval
        card.
      </p>
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
        <p className="px-2 py-3 text-xs text-muted">
          {search.trim() ? "No matching audit entries." : "No approval decisions recorded yet."}
        </p>
      )}
      {rows.map((row) => (
        <SettingRow
          key={row.id}
          label={row.tool}
          description={`${row.decision} · ${new Date(row.ts).toLocaleString()}${row.detail ? ` · ${row.detail}` : ""}`}
        >
          <span className="text-xs text-muted">{row.conversation_id ?? "global"}</span>
        </SettingRow>
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
          placeholder={models.length ? "Select a model" : "No models"}
          aria-label="Default model"
          disabled={models.length === 0}
          options={models.map((id) => ({ value: id, label: id }))}
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
          placeholder={models.length ? "None" : "No models"}
          aria-label="Vision fallback model"
          disabled={models.length === 0}
          options={[{ value: "", label: "None (text only)" }, ...models.map((id) => ({ value: id, label: id }))]}
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
  const [version, setVersion] = useState("…");
  const [update, setUpdate] = useState<Update | null>(null);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getAppVersion().then((v) => {
      if (live) setVersion(v);
    });
    return () => {
      live = false;
    };
  }, []);

  useEffect(
    () => () => {
      update?.close().catch(() => undefined);
    },
    [update],
  );

  const checkNow = async () => {
    setChecking(true);
    setStatus(null);
    try {
      const found = await check();
      if (!found) {
        setUpdate(null);
        setStatus(`You're on the latest version (${version}).`);
      } else {
        setUpdate(found);
      }
    } catch (e) {
      setUpdate(null);
      setStatus(channelMessage(e));
    } finally {
      setChecking(false);
    }
  };

  const install = async () => {
    if (!update) return;
    setProgress(0);
    try {
      await installUpdate(update, (pct) => setProgress(pct));
    } catch (e) {
      setProgress(null);
      setStatus(channelMessage(e));
    }
  };

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
