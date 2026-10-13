import { useApp } from "../lib/store";
import { Button, Select } from "./ui";

export function TopBar() {
  const {
    connections,
    activeConnectionId,
    selectConnection,
    models,
    loadingModels,
    refreshModels,
    model,
    setModel,
  } = useApp();

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-neutral-800 px-4">
      <Select
        className="w-48"
        value={activeConnectionId ?? ""}
        onChange={(e) => selectConnection(e.target.value || null)}
        aria-label="Connection"
      >
        <option value="">No connection</option>
        {connections.map((connection) => (
          <option key={connection.id} value={connection.id}>
            {connection.name}
          </option>
        ))}
      </Select>

      <Select
        className="flex-1"
        value={model}
        onChange={(e) => setModel(e.target.value)}
        aria-label="Model"
        disabled={models.length === 0}
      >
        <option value="">
          {loadingModels ? "Loading models…" : models.length ? "Select a model" : "No models"}
        </option>
        {models.map((id) => (
          <option key={id} value={id}>
            {id}
          </option>
        ))}
      </Select>

      <Button
        variant="ghost"
        size="sm"
        onClick={() => void refreshModels()}
        disabled={!activeConnectionId || loadingModels}
      >
        Refresh
      </Button>
    </header>
  );
}
