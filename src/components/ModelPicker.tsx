import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../lib/store";
import * as api from "../lib/api";
import * as db from "../lib/db";
import {
  OptionList,
  Popup,
  buildRows,
  firstEnabled,
  stepEnabled,
  useFloating,
  type Option,
} from "./ui/select/shared";

interface Anchor {
  anchor: HTMLElement;
}
let current: Anchor | null = null;
const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function openModelPicker(anchor: HTMLElement) {
  if (current?.anchor === anchor) {
    current = null;
    emit();
    return;
  }
  current = { anchor };
  emit();
}

function closeModelPicker() {
  if (!current) return;
  current = null;
  emit();
}

export function ModelPickerHost() {
  const { connections, activeConnectionId, selectConnection, model, setModel } = useApp();
  const [state, setState] = useState<Anchor | null>(null);
  const [options, setOptions] = useState<Option[] | null>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const anchorRef = useRef<HTMLElement | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => subscribe(() => setState(current)), []);

  const open = state !== null;
  anchorRef.current = state?.anchor ?? null;
  const pos = useFloating(open, anchorRef, 320, 6, 300);

  useEffect(() => {
    if (!open || !anchorRef.current) return;
    setQuery("");
    setOptions(null);
    let live = true;
    Promise.all(
      connections.map(async (connection): Promise<Option[]> => {
        try {
          const hasKey = await api.hasApiKey(connection.id);
          if (!hasKey) return [];
          const [list, hidden] = await Promise.all([
            api.listModels(connection.base_url, connection.id, connection.kind),
            db.listHiddenModels(connection.id),
          ]);
          const hiddenSet = new Set(hidden);
          return list
            .filter((m) => !hiddenSet.has(m))
            .map((m) => ({ value: `${connection.id}/${m}`, label: m, group: connection.name }));
        } catch (cause) {
          console.warn("model list failed", connection.name, cause);
          return [];
        }
      }),
    ).then((groups) => {
      if (live) setOptions(groups.flat());
    });
    return () => {
      live = false;
    };
  }, [open, connections]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (anchorRef.current?.contains(target)) return;
      if ((e.target as Element).closest('[data-model-picker]')) return;
      closeModelPicker();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeModelPicker();
    };
    document.addEventListener("mousedown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const q = query.trim().toLowerCase();
  const visible = useMemo(() => {
    const list = options ?? [];
    if (!q) return list;
    return list.filter(
      (o) => o.label.toLowerCase().includes(q) || o.group?.toLowerCase().includes(q),
    );
  }, [options, q]);
  const rows = useMemo(() => buildRows(visible), [visible]);

  useEffect(() => {
    if (!open) return;
    const selected = visible.findIndex(
      (o) => o.value === (activeConnectionId && model ? `${activeConnectionId}/${model}` : ""),
    );
    setActive(selected >= 0 ? selected : firstEnabled(visible));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, q, visible.length]);

  const value = activeConnectionId && model ? `${activeConnectionId}/${model}` : null;

  const pick = (index: number) => {
    const option = visible[index];
    if (!option || option.disabled) return;
    const slash = option.value.indexOf("/");
    const connectionId = option.value.slice(0, slash);
    const modelId = option.value.slice(slash + 1);
    if (connectionId !== activeConnectionId) selectConnection(connectionId);
    setModel(modelId);
    closeModelPicker();
  };

  if (!open || !pos) return null;

  return (
    <Popup pos={pos}>
      <div data-model-picker className="flex min-h-0 flex-1 flex-col">
        <input
          ref={inputRef}
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive(stepEnabled(visible, active, 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive(stepEnabled(visible, active, -1));
            } else if (e.key === "Enter") {
              if (active >= 0) {
                e.preventDefault();
                pick(active);
              }
            } else if (e.key === "Escape") {
              e.preventDefault();
              closeModelPicker();
            }
          }}
          placeholder="Search models"
          aria-label="Search models"
          className="mx-0.5 mb-1.5 h-8 shrink-0 rounded-ui border border-ui-line bg-ui-field px-2.5 text-sm text-ui-fg outline-none placeholder:text-ui-muted focus:border-ui-accent"
        />
        {options === null ? (
          <div className="px-2.5 py-3.5 text-center text-[13px] text-ui-muted">Loading models…</div>
        ) : visible.length === 0 ? (
          <div className="px-2.5 py-3.5 text-center text-[13px] text-ui-muted">No models</div>
        ) : (
          <OptionList
            id="model-picker-list"
            rows={rows}
            active={active}
            selected={(o) => o.value === value}
            onPick={pick}
            onActive={setActive}
            query={q}
          />
        )}
      </div>
    </Popup>
  );
}
