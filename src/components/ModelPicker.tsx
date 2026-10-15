import { useEffect, useState } from "react";
import { useApp } from "../lib/store";
import * as api from "../lib/api";
import * as db from "../lib/db";
import type { Connection } from "../lib/types";
import { showMenu } from "./Menu";

interface ProviderGroup {
  connection: Connection;
  hasKey: boolean;
  models: string[];
}

function ModelPickerContent({ onDone }: { onDone: () => void }) {
  const {
    connections,
    activeConnectionId,
    selectConnection,
    model,
    setModel,
    setSettingsPage,
  } = useApp();
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<ProviderGroup[] | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all(
      connections.map(async (connection): Promise<ProviderGroup> => {
        try {
          const hasKey = await api.hasApiKey(connection.id);
          if (!hasKey) return { connection, hasKey, models: [] };
          const [models, hidden] = await Promise.all([
            api.listModels(connection.base_url, connection.id, connection.kind),
            db.listHiddenModels(connection.id),
          ]);
          const hiddenSet = new Set(hidden);
          return { connection, hasKey, models: models.filter((m) => !hiddenSet.has(m)) };
        } catch {
          return { connection, hasKey: true, models: [] };
        }
      }),
    ).then((loaded) => {
      if (live) setGroups(loaded);
    });
    return () => {
      live = false;
    };
  }, [connections]);

  const pick = (connectionId: string, modelId: string) => {
    if (connectionId !== activeConnectionId) selectConnection(connectionId);
    setModel(modelId);
    onDone();
  };

  const q = query.trim().toLowerCase();
  const visible = (groups ?? [])
    .map((group) => ({
      ...group,
      models: group.models.filter((m) => !q || m.toLowerCase().includes(q)),
    }))
    .filter((group) => !q || group.models.length > 0);

  return (
    <div className="w-[300px]">
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search models"
        aria-label="Search models"
        className="sticky top-0 z-10 mx-0.5 mb-1.5 h-8 w-[calc(100%-4px)] rounded-card border border-border bg-surface-2 px-2.5 text-sm outline-none placeholder:text-muted focus:border-accent"
      />
      <div className="max-h-[280px] overflow-auto">
        {groups === null && (
          <div className="px-2 py-3 text-center text-[13px] text-muted">Loading models…</div>
        )}
        {visible.map((group) => (
          <div key={group.connection.id}>
            <div className="px-2 pb-0.5 pt-1.5 text-[11px] uppercase text-muted">
              {group.connection.name}
              {group.connection.id === activeConnectionId ? " · active" : ""}
            </div>
            {!group.hasKey && (
              <div className="px-2 py-1 text-[13px] text-muted">No key stored</div>
            )}
            {group.hasKey &&
              group.models.map((id) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => pick(group.connection.id, id)}
                  className="flex min-h-8 w-full items-center gap-1.5 rounded-control px-2 py-1 text-left text-sm hover:bg-hover"
                >
                  <span className="min-w-0 flex-1 break-all">{id}</span>
                  {group.connection.id === activeConnectionId && model === id && (
                    <span className="text-accent">✓</span>
                  )}
                </button>
              ))}
          </div>
        ))}
        {groups !== null && visible.length === 0 && (
          <div className="px-2 py-3 text-center text-[13px] text-muted">No models</div>
        )}
        <button
          type="button"
          onClick={() => {
            onDone();
            setSettingsPage("general");
          }}
          className="mt-1 flex h-8 w-full items-center rounded-control px-2 text-left text-[13px] text-muted hover:bg-hover hover:text-text"
        >
          Manage connections…
        </button>
      </div>
    </div>
  );
}

export function openModelPicker(anchor: HTMLElement) {
  showMenu(anchor, <ModelPickerContent onDone={() => undefined} />, {
    above: true,
    width: 300,
  });
}
