import { useCallback, useEffect, useState } from "react";
import { ChevronDown, Eye, EyeOff, PlugZap, Plus } from "lucide-react";
import { useApp } from "../../lib/store";
import * as api from "../../lib/api";
import * as db from "../../lib/db";
import {
  DEFAULT_BASE_URLS,
  connectionInputSchema,
  type Connection,
  type ProviderKind,
} from "../../lib/types";
import { Button, Dialog, Input, Select, Spinner } from "../ui";
import { confirmDialog } from "../ConfirmDialog";
import { toast } from "../../lib/toast";
import { errorText } from "../../lib/utils";

function StatusPill({ stored }: { stored: boolean | null }) {
  if (stored === null) {
    return <span className="rounded bg-hover px-2 py-0.5 text-xs text-muted">Checking…</span>;
  }
  return stored ? (
    <span className="rounded bg-success/15 px-2 py-0.5 text-xs text-success">Connected</span>
  ) : (
    <span className="rounded bg-hover px-2 py-0.5 text-xs text-muted">No key</span>
  );
}

function ProviderDialog({
  open,
  connection,
  onClose,
}: {
  open: boolean;
  connection: Connection | null;
  onClose: () => void;
}) {
  const { saveConnection, refreshModels, activeConnectionId } = useApp();
  const [kind, setKind] = useState<ProviderKind>(connection?.kind ?? "openrouter");
  const [name, setName] = useState(connection?.name ?? "OpenRouter");
  const [baseUrl, setBaseUrl] = useState(
    connection?.base_url ?? DEFAULT_BASE_URLS.openrouter,
  );
  const [key, setKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [defaultModel, setDefaultModel] = useState(connection?.default_model ?? "");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setKind(connection?.kind ?? "openrouter");
    setName(connection?.name ?? "OpenRouter");
    setBaseUrl(connection?.base_url ?? DEFAULT_BASE_URLS.openrouter);
    setKey("");
    setShowKey(false);
    setDefaultModel(connection?.default_model ?? "");
    setStatus(null);
  }, [open, connection]);

  const save = async (testFirst: boolean) => {
    const parsed = connectionInputSchema.safeParse({
      name: name.trim(),
      kind,
      base_url: baseUrl.trim(),
      default_model: defaultModel.trim() || null,
    });
    if (!parsed.success) {
      setStatus(parsed.error.issues[0]?.message ?? "Invalid provider");
      return;
    }
    setBusy(true);
    try {
      const saved = await saveConnection(parsed.data, connection?.id);
      if (key.trim()) {
        await api.setApiKey(saved.id, key.trim());
        setKey("");
      }
      if (testFirst || saved.id === activeConnectionId) {
        const models = await api.listModels(saved.base_url, saved.id);
        setStatus(`Connected · ${models.length} models found`);
        if (saved.id === activeConnectionId) await refreshModels();
        if (!testFirst) onClose();
      } else {
        onClose();
      }
    } catch (e) {
      const raw = errorText(e);
      const { hint } = api.classifyStreamError(raw);
      setStatus(hint === "Provider error. Raw message below." ? raw : `${hint} ${raw}`.slice(0, 300));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title={connection ? "Edit provider" : "Add provider"}>
      <div className="flex flex-col gap-2.5">
        <label className="flex flex-col gap-1 text-xs text-muted">
          Type
          <Select
            value={kind}
            onChange={(e) => {
              const next = e.target.value as ProviderKind;
              setKind(next);
              setBaseUrl(DEFAULT_BASE_URLS[next]);
              if (!name.trim() || name === "OpenRouter" || name === "Agent Router" || name === "Custom") {
                setName(
                  next === "openrouter"
                    ? "OpenRouter"
                    : next === "agentrouter"
                      ? "Agent Router"
                      : "Custom",
                );
              }
            }}
          >
            <option value="openrouter">OpenRouter</option>
            <option value="agentrouter">Agent Router</option>
            <option value="custom">Custom (OpenAI-compatible)</option>
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Name
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Base URL
          <Input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="https://"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          API key
          <span className="flex gap-1">
            <Input
              type={showKey ? "text" : "password"}
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={connection ? "Leave blank to keep the stored key" : "sk-…"}
              autoComplete="off"
            />
            <Button
              variant="default"
              size="icon"
              aria-label={showKey ? "Hide key" : "Show key"}
              onClick={() => setShowKey((v) => !v)}
            >
              {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
            </Button>
          </span>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted">
          Default model <span className="text-muted">(optional)</span>
          <Input
            value={defaultModel}
            onChange={(e) => setDefaultModel(e.target.value)}
            placeholder="e.g. anthropic/claude-sonnet-4"
          />
        </label>
        {status && (
          <p className="text-xs text-muted" role="status">
            {status}
          </p>
        )}
        <div className="mt-1.5 flex justify-end gap-2">
          <Button variant="default" onClick={onClose}>
            Cancel
          </Button>
          {connection && (
            <Button variant="default" disabled={busy} onClick={() => void save(true)}>
              {busy ? <Spinner label="Testing…" /> : "Test connection"}
            </Button>
          )}
          <Button variant="primary" disabled={busy} onClick={() => void save(false)}>
            Save
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

function ProviderModels({ connection }: { connection: Connection }) {
  const { toggleModelVisibility, setAllModelsVisibility } = useApp();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [models, setModels] = useState<string[] | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    if (!open || models !== null) return;
    let live = true;
    setLoading(true);
    Promise.all([
      api.listModels(connection.base_url, connection.id),
      db.listHiddenModels(connection.id),
    ])
      .then(([list, hiddenList]) => {
        if (!live) return;
        setModels(list);
        setHidden(new Set(hiddenList));
      })
      .catch((e) => {
        if (!live) return;
        const raw = errorText(e);
        const { hint } = api.classifyStreamError(raw);
        toast(hint === "Provider error. Raw message below." ? raw : `${hint} ${raw}`.slice(0, 300));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, connection.id]);

  const toggle = async (modelId: string) => {
    const next = !hidden.has(modelId);
    setBusyId(modelId);
    try {
      await toggleModelVisibility(connection.id, modelId, next);
      setHidden((prev) => {
        const copy = new Set(prev);
        if (next) copy.add(modelId);
        else copy.delete(modelId);
        return copy;
      });
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBusyId(null);
    }
  };

  const filtered = (models ?? []).filter((m) =>
    m.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const setAll = async (hide: boolean) => {
    setBulkBusy(true);
    try {
      await setAllModelsVisibility(connection.id, filtered, hide);
      setHidden((prev) => {
        if (!hide) return new Set<string>();
        const copy = new Set(prev);
        for (const m of filtered) copy.add(m);
        return copy;
      });
    } catch (e) {
      toast(errorText(e));
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <div className="mt-1.5 border-t border-border pt-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1 text-xs text-muted hover:text-text"
      >
        <ChevronDown size={14} className={open ? "rotate-180" : ""} />
        Models{models !== null && ` (${models.length - hidden.size} shown)`}
      </button>
      {open && (
        <div className="mt-1.5 flex flex-col gap-1.5">
          {loading && <Spinner label="Loading models…" />}
          {!loading && models !== null && (
            <>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter models…"
                aria-label="Filter models"
              />
              <div className="flex items-center gap-2 px-1.5">
                <span className="flex-1 text-xs text-muted">
                  {hidden.size} of {models.length} hidden
                </span>
                <button
                  type="button"
                  disabled={bulkBusy || filtered.length === 0}
                  onClick={() => void setAll(true)}
                  className="text-xs text-muted hover:text-text disabled:opacity-50"
                >
                  Hide all
                </button>
                <button
                  type="button"
                  disabled={bulkBusy || hidden.size === 0}
                  onClick={() => void setAll(false)}
                  className="text-xs text-muted hover:text-text disabled:opacity-50"
                >
                  Show all
                </button>
              </div>
              <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
                {filtered.map((modelId) => (
                  <div
                    key={modelId}
                    className="flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-hover"
                  >
                    <span className="min-w-0 flex-1 truncate font-mono">{modelId}</span>
                    <button
                      type="button"
                      disabled={busyId === modelId}
                      onClick={() => void toggle(modelId)}
                      aria-label={hidden.has(modelId) ? `Show ${modelId}` : `Hide ${modelId}`}
                      title={hidden.has(modelId) ? "Show in picker" : "Hide from picker"}
                      className="grid h-6 w-6 flex-none place-items-center rounded text-muted hover:bg-active hover:text-text"
                    >
                      {hidden.has(modelId) ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                ))}
                {filtered.length === 0 && (
                  <p className="px-1.5 py-2 text-xs text-muted">No models match.</p>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function ProvidersPage() {
  const { connections, removeConnection, refreshModels } = useApp();
  const [dialog, setDialog] = useState<{ open: boolean; connection: Connection | null }>({
    open: false,
    connection: null,
  });
  const [keyState, setKeyState] = useState<Record<string, boolean | null>>({});
  const [testingId, setTestingId] = useState<string | null>(null);

  const reloadKeys = useCallback(async () => {
    const entries = await Promise.all(
      connections.map(async (c) => {
        try {
          return [c.id, await api.hasApiKey(c.id)] as const;
        } catch {
          return [c.id, null] as const;
        }
      }),
    );
    setKeyState(Object.fromEntries(entries));
  }, [connections]);

  useEffect(() => {
    void reloadKeys();
  }, [reloadKeys]);

  const test = async (connection: Connection) => {
    setTestingId(connection.id);
    try {
      const models = await api.listModels(connection.base_url, connection.id);
      toast(`Connected · ${models.length} models found`);
    } catch (e) {
      toast(errorText(e));
    } finally {
      setTestingId(null);
    }
  };

  const remove = async (connection: Connection) => {
    const confirmed = await confirmDialog({
      title: "Delete provider?",
      body: `${connection.name} and its stored key will be removed.`,
      danger: true,
      ok: "Delete",
    });
    if (!confirmed) return;
    await removeConnection(connection.id);
    await refreshModels();
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm text-muted">Bring your own API keys.</span>
        <Button variant="primary" onClick={() => setDialog({ open: true, connection: null })}>
          <Plus size={16} /> Add provider
        </Button>
      </div>

      {connections.length === 0 && (
        <div className="flex flex-col items-center gap-2.5 py-6 text-center">
          <PlugZap size={40} className="text-muted" />
          <h3 className="m-0 text-sm font-semibold">No providers yet</h3>
          <Button variant="primary" onClick={() => setDialog({ open: true, connection: null })}>
            Add your first provider
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {connections.map((connection) => (
          <div
            key={connection.id}
            className="rounded-card border border-border bg-surface p-3"
          >
            <div className="flex items-center gap-2.5">
            <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-accent text-xs font-semibold text-accent-contrast">
              {connection.name.slice(0, 2).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <b className="block truncate text-sm">{connection.name}</b>
              <div className="truncate font-mono text-xs text-muted">{connection.base_url}</div>
            </div>
            <StatusPill stored={keyState[connection.id] ?? null} />
            <Button
              variant="default"
              size="sm"
              disabled={testingId === connection.id}
              onClick={() => void test(connection)}
            >
              {testingId === connection.id ? <Spinner label="Testing…" /> : "Test"}
            </Button>
            <Button
              variant="default"
              size="sm"
              onClick={() => setDialog({ open: true, connection })}
            >
              Edit
            </Button>
            <Button variant="danger" size="sm" onClick={() => void remove(connection)}>
              Delete
            </Button>
            </div>
          <ProviderModels connection={connection} />
          </div>
        ))}
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
        Keys are stored in the Windows Credential Manager on this device only.
      </p>

      <ProviderDialog
        open={dialog.open}
        connection={dialog.connection}
        onClose={() => {
          setDialog({ open: false, connection: null });
          void reloadKeys();
        }}
      />
    </div>
  );
}
