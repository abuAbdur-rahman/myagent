import { useCallback, useEffect, useState } from "react";
import { ChevronDown, Eye, EyeOff, PlugZap, Plus, RotateCcw } from "lucide-react";
import { useApp } from "../../lib/store";
import * as api from "../../lib/api";
import * as db from "../../lib/db";
import {
  DEFAULT_BASE_URLS,
  KEYLESS_KINDS,
  PROVIDER_KINDS,
  PROVIDER_LABELS,
  connectionInputSchema,
  type Connection,
  type ProviderKind,
} from "../../lib/types";
import { Button, Dialog, Input, Pill, Spinner, type PillTone } from "../ui";
import { Select } from "../ui/select";
import { confirmDialog } from "../ConfirmDialog";
import { toast } from "../../lib/toast";
import { errorText, rollbackConnection } from "../../lib/utils";
import { timeAgo } from "../../lib/grouping";
import { KEY_STATUS_TEXT, keyStatus, type KeyStatus } from "../../lib/providers";

type KeyState = { hint: string | null; error: string | null };
type TestState = { ok: boolean; text: string };

const STATUS_TONE: Record<KeyStatus, PillTone> = {
  keyless: "neutral",
  checking: "neutral",
  unreadable: "danger",
  missing: "danger",
  untested: "warn",
  connected: "success",
};

function KeyPill({
  connection,
  state,
}: {
  connection: Connection;
  state: KeyState | undefined;
}) {
  const status = keyStatus({
    keyless: KEYLESS_KINDS.has(connection.kind),
    loaded: state !== undefined,
    error: state?.error ?? null,
    hint: state?.hint ?? null,
    testedAt: connection.key_tested_at ?? null,
  });
  return <Pill tone={STATUS_TONE[status]}>{KEY_STATUS_TEXT[status]}</Pill>;
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
  const { saveConnection, removeConnection } = useApp();
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
    const isNew = !connection;
    if (isNew && !key.trim() && !KEYLESS_KINDS.has(kind)) {
      setStatus("Enter an API key to add a provider.");
      return;
    }
    setBusy(true);
    let savedId: string | null = null;
    try {
      const saved = await saveConnection(parsed.data, connection?.id);
      savedId = saved.id;
      if (key.trim()) {
        await api.setApiKey(saved.id, key.trim());
        setKey("");
      }
      const found = await api.verifyProvider(saved.id, saved.kind);
      if (found === 0) {
        throw new Error("No models found. Check the API key and base URL.");
      }
      await db.markKeyTested(saved.id);
      setStatus(`Connected · ${found} models found`);
      if (!testFirst) onClose();
    } catch (e) {
      if (isNew) await rollbackConnection(removeConnection, savedId);
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
            onChange={(next) => {
              setKind(next);
              setBaseUrl(DEFAULT_BASE_URLS[next]);
              const known = PROVIDER_KINDS.map((value) => PROVIDER_LABELS[value]);
              if (!name.trim() || known.includes(name)) {
                setName(PROVIDER_LABELS[next]);
              }
            }}
            options={PROVIDER_KINDS.map((value) => ({
              value,
              label: PROVIDER_LABELS[value],
            }))}
          />
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
          {KEYLESS_KINDS.has(kind) ? (
            <span className="text-xs text-muted">
              {PROVIDER_LABELS[kind]} needs no key.
            </span>
          ) : (
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
          )}
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
          <Button variant="default" disabled={busy} onClick={() => void save(true)}>
            {busy ? <Spinner label="Testing…" /> : "Test connection"}
          </Button>
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
      api.listModels(connection.id, connection.kind),
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
  const { connections, removeConnection, refreshConnections, refreshModels } = useApp();
  const [dialog, setDialog] = useState<{ open: boolean; connection: Connection | null }>({
    open: false,
    connection: null,
  });
  const [keyState, setKeyState] = useState<Record<string, KeyState>>({});
  const [testState, setTestState] = useState<Record<string, TestState>>({});
  const [testingId, setTestingId] = useState<string | null>(null);

  const reloadKeys = useCallback(async () => {
    const entries = await Promise.all(
      connections.map(async (c) => {
        try {
          return [c.id, { hint: await api.apiKeyHint(c.id), error: null }] as const;
        } catch (e) {
          return [c.id, { hint: null, error: errorText(e) }] as const;
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
      const found = await api.verifyProvider(connection.id, connection.kind);
      await db.markKeyTested(connection.id);
      await refreshConnections();
      setTestState((prev) => ({
        ...prev,
        [connection.id]: { ok: true, text: `Connected · ${found} models found` },
      }));
    } catch (e) {
      const raw = errorText(e);
      const { hint } = api.classifyStreamError(raw);
      setTestState((prev) => ({
        ...prev,
        [connection.id]: {
          ok: false,
          text: hint === "Provider error. Raw message below." ? raw : `${hint} ${raw}`.slice(0, 300),
        },
      }));
    } finally {
      setTestingId(null);
    }
  };

  const removeKey = async (connection: Connection) => {
    const confirmed = await confirmDialog({
      title: "Remove the stored key?",
      body: `${connection.name} keeps its base URL and models, but sending fails until you add a key again.`,
      danger: true,
      ok: "Remove key",
    });
    if (!confirmed) return;
    try {
      await api.deleteApiKey(connection.id);
      await db.clearKeyTested(connection.id);
      await refreshConnections();
      await reloadKeys();
      toast("Key removed");
    } catch (e) {
      toast(errorText(e));
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
        {connections.map((connection) => {
          const state = keyState[connection.id];
          const tested = connection.key_tested_at;
          return (
            <div
              key={connection.id}
              className="rounded-card border border-border bg-surface p-3"
              data-setting-term={connection.name}
            >
              <div className="flex items-center gap-2.5">
                <span className="grid h-8 w-8 flex-none place-items-center rounded-full bg-accent text-xs font-semibold text-accent-contrast">
                  {connection.name.slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <b className="block truncate text-sm">{connection.name}</b>
                  <div className="truncate font-mono text-xs text-muted">{connection.base_url}</div>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                    {state?.hint && <span className="font-mono">{state.hint}</span>}
                    {state?.error && <span className="text-danger">{state.error}</span>}
                    {tested ? (
                      <span>Tested {timeAgo(tested)}</span>
                    ) : (
                      state?.hint && <span>Never tested</span>
                    )}
                  </div>
                </div>
                <KeyPill connection={connection} state={state} />
                <Button
                  variant="default"
                  size="sm"
                  disabled={testingId === connection.id}
                  onClick={() => void test(connection)}
                >
                  {testingId === connection.id ? <Spinner label="Testing…" /> : "Test"}
                </Button>
                {state?.hint && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove the stored key for ${connection.name}`}
                    title="Remove the stored key"
                    onClick={() => void removeKey(connection)}
                  >
                    <RotateCcw size={14} />
                  </Button>
                )}
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
              {testState[connection.id] && (
                <p
                  className={
                    testState[connection.id].ok
                      ? "mt-1.5 text-xs text-success"
                      : "mt-1.5 text-xs text-danger"
                  }
                  role="status"
                >
                  {testState[connection.id].text}
                </p>
              )}
              <ProviderModels connection={connection} />
            </div>
          );
        })}
      </div>

      <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
        Keys are stored in the Windows Credential Manager on this device only. The page shows the
        last four characters, never the key.
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
