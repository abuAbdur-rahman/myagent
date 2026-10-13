import { useCallback, useEffect, useState } from "react";
import { Check, Moon, Sun, Monitor } from "lucide-react";
import { useApp, type ThemeMode } from "../../lib/store";
import * as db from "../../lib/db";
import { MemoryEditor } from "../MemoryEditor";
import { Button, Input, Select } from "../ui";
import { confirmDialog } from "../ConfirmDialog";
import { downloadText, errorText } from "../../lib/utils";
import { toast } from "../../lib/toast";
import { cn } from "../../lib/utils";
import { openUrl } from "@tauri-apps/plugin-opener";
import type { Memory } from "../../lib/types";

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
  const { displayName, setDisplayName, sendWith, setSendWith } = useApp();
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
          value={sendWith}
          onChange={(e) => setSendWith(e.target.value as "enter" | "ctrl")}
          aria-label="Send message with"
        >
          <option value="enter">Enter</option>
          <option value="ctrl">Ctrl+Enter</option>
        </Select>
      </SettingRow>
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
  const { models, model, setModel, activeConnection, refreshModels, loadingModels } = useApp();
  return (
    <div>
      <SettingRow
        label="Default model"
        description={activeConnection ? `From ${activeConnection.name}` : "Add a provider first"}
      >
        <Select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          aria-label="Default model"
          disabled={models.length === 0}
        >
          <option value="">{models.length ? "Select a model" : "No models"}</option>
          {models.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </Select>
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
  const { conversations, removeConversation } = useApp();
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
  return (
    <div>
      <SettingRow label="App name" description="">
        <span className="text-sm">myagent</span>
      </SettingRow>
      <SettingRow label="Version" description="">
        <span className="text-sm">0.1.0</span>
      </SettingRow>
      <SettingRow label="Status" description="Local-first BYOK desktop client">
        <span className="text-sm text-success">Ready</span>
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
