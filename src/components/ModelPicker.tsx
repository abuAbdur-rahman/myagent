import { useState } from "react";
import { useApp } from "../lib/store";
import { showMenu } from "./Menu";

function ModelPickerContent({ onDone }: { onDone: () => void }) {
  const { models, model, activeConnection, setModel, setSettingsPage } = useApp();
  const [query, setQuery] = useState("");

  const list = models.filter((m) => !query || m.toLowerCase().includes(query.toLowerCase()));

  const pick = (modelId: string) => {
    setModel(modelId);
    onDone();
  };

  return (
    <div className="w-[300px]">
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search models"
        aria-label="Search models"
        className="mx-0.5 mb-1.5 h-8 w-[calc(100%-4px)] rounded-card border border-border bg-surface-2 px-2.5 text-sm outline-none placeholder:text-muted focus:border-accent"
      />
      <div className="max-h-[280px] overflow-auto">
        {activeConnection && (
          <div className="px-2 pb-0.5 pt-1.5 text-[11px] uppercase text-muted">
            {activeConnection.name}
          </div>
        )}
        {list.map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => pick(id)}
            className="flex min-h-8 w-full items-center gap-1.5 rounded-control px-2 py-1 text-left text-sm hover:bg-hover"
          >
            <span className="min-w-0 flex-1 break-all">{id}</span>
            {model === id && <span className="text-accent">✓</span>}
          </button>
        ))}
        {list.length === 0 && (
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
