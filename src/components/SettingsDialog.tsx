import { useEffect, useState } from "react";
import * as api from "../lib/api";
import { useApp } from "../lib/store";
import { DEFAULT_BASE_URLS, connectionInputSchema, type ProviderKind } from "../lib/types";
import { Button, Dialog, Input, Select } from "./ui";

interface FormState {
  name: string;
  kind: ProviderKind;
  base_url: string;
  default_model: string;
}

const emptyForm: FormState = {
  name: "OpenRouter",
  kind: "openrouter",
  base_url: DEFAULT_BASE_URLS.openrouter,
  default_model: "",
};

export function SettingsDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const {
    connections,
    activeConnectionId,
    saveConnection,
    removeConnection,
    refreshModels,
  } = useApp();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [apiKey, setApiKey] = useState("");
  const [keyStored, setKeyStored] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setStatus(null);
    setApiKey("");

    const connection = editingId
      ? connections.find((c) => c.id === editingId)
      : undefined;

    if (connection) {
      setForm({
        name: connection.name,
        kind: connection.kind,
        base_url: connection.base_url,
        default_model: connection.default_model ?? "",
      });
      void api
        .hasApiKey(connection.id)
        .then((has) => {
          if (!cancelled) setKeyStored(has);
        })
        .catch(() => {
          if (!cancelled) setKeyStored(false);
        });
    } else {
      setForm(emptyForm);
      setKeyStored(false);
    }

    return () => {
      cancelled = true;
    };
  }, [open, editingId, connections]);

  const startNew = () => {
    setEditingId(null);
    setForm(emptyForm);
    setKeyStored(false);
    setApiKey("");
    setStatus(null);
  };

  const save = async () => {
    const parsed = connectionInputSchema.safeParse({
      name: form.name.trim(),
      kind: form.kind,
      base_url: form.base_url.trim(),
      default_model: form.default_model.trim() || null,
    });
    if (!parsed.success) {
      setStatus(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setBusy(true);
    try {
      const saved = await saveConnection(parsed.data, editingId ?? undefined);
      setEditingId(saved.id);
      setStatus("Saved.");
    } catch (e) {
      setStatus(String(e));
    } finally {
      setBusy(false);
    }
  };

  const storeKey = async () => {
    if (!editingId) {
      setStatus("Save the connection first, then store a key.");
      return;
    }
    if (!apiKey.trim()) {
      setStatus("Enter an API key first.");
      return;
    }
    setBusy(true);
    try {
      await api.setApiKey(editingId, apiKey.trim());
      setApiKey("");
      setKeyStored(true);
      setStatus("Key stored in Windows Credential Manager.");
      if (editingId === activeConnectionId) await refreshModels();
    } catch (e) {
      setStatus(String(e));
    } finally {
      setBusy(false);
    }
  };

  const clearKey = async () => {
    if (!editingId) return;
    setBusy(true);
    try {
      await api.deleteApiKey(editingId);
      setKeyStored(false);
      setStatus("Key removed.");
    } catch (e) {
      setStatus(String(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!editingId) return;
    const target = connections.find((c) => c.id === editingId);
    if (
      !window.confirm(
        `Delete "${target?.name ?? "this connection"}" and its stored API key? This cannot be undone.`,
      )
    ) {
      return;
    }
    setBusy(true);
    try {
      await removeConnection(editingId);
      startNew();
    } catch (e) {
      setStatus(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} title="Connections & BYOK">
      <div className="grid grid-cols-[180px_1fr] gap-4">
        <div className="space-y-1">
          <Button variant="secondary" size="sm" className="w-full" onClick={startNew}>
            + Add connection
          </Button>
          {connections.map((connection) => (
            <button
              key={connection.id}
              type="button"
              onClick={() => setEditingId(connection.id)}
              className={`w-full truncate rounded-control px-2 py-2 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                editingId === connection.id
                  ? "bg-vault-raised text-text-primary"
                  : "text-text-muted hover:bg-vault-raised/60"
              }`}
            >
              {connection.name}
            </button>
          ))}
        </div>

        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-xs text-text-muted">Name</label>
            <Input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="OpenRouter"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-text-muted">Provider</label>
            <Select
              value={form.kind}
              onChange={(e) => {
                const kind = e.target.value as ProviderKind;
                setForm({ ...form, kind, base_url: DEFAULT_BASE_URLS[kind] });
              }}
            >
              <option value="openrouter">OpenRouter</option>
              <option value="custom">Custom (OpenAI-compatible)</option>
            </Select>
          </div>

          <div>
            <label className="mb-1 block text-xs text-text-muted">Base URL</label>
            <Input
              value={form.base_url}
              onChange={(e) => setForm({ ...form, base_url: e.target.value })}
              placeholder="https://openrouter.ai/api/v1"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs text-text-muted">Default model</label>
            <Input
              value={form.default_model}
              onChange={(e) => setForm({ ...form, default_model: e.target.value })}
              placeholder="anthropic/claude-3.5-sonnet (optional)"
            />
          </div>

          <div className="rounded-control border border-vault-line p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs text-text-muted">API key (BYOK)</span>
              <span className={`text-xs ${keyStored ? "text-stored" : "text-text-faint"}`}>
                {keyStored ? "Stored" : "Not stored"}
              </span>
            </div>
            <div className="flex gap-2">
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={editingId ? "sk-…" : "Save connection first"}
                disabled={!editingId}
                autoComplete="off"
              />
              <Button variant="secondary" onClick={() => void storeKey()} disabled={!editingId || busy}>
                Store
              </Button>
              <Button
                variant="ghost"
                onClick={() => void clearKey()}
                disabled={!editingId || !keyStored || busy}
              >
                Clear
              </Button>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <div className="text-xs text-text-muted" role="status">
              {status}
            </div>
            <div className="flex gap-2">
              {editingId && (
                <Button variant="destructive" onClick={() => void remove()} disabled={busy}>
                  Delete
                </Button>
              )}
              <Button onClick={() => void save()} disabled={busy}>
                Save
              </Button>
            </div>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
