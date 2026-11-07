import { useState } from "react";
import { Check, KeyRound, Plug, ShieldCheck } from "lucide-react";
import { Logo } from "./Logo";
import { useApp } from "../lib/store";
import * as api from "../lib/api";
import { DEFAULT_BASE_URLS, KEYLESS_KINDS, PROVIDER_LABELS, connectionInputSchema, type Connection, type ConnectionInput, type ProviderKind } from "../lib/types";
import { Button, Input, Spinner } from "./ui";
import { ProviderIcon } from "./ProviderIcon";
import { cn, errorText, rollbackConnection } from "../lib/utils";

const SUGGESTIONS = [
  "Explain how closures work in JavaScript",
  "Draft a friendly email to a new client",
  "Debug a slow SQL query",
  "Plan a two-week learning roadmap",
];

async function persistKeyFailure(
  saved: Connection,
  keyError: string,
  created: boolean,
  removeConnection: (id: string) => Promise<void>,
): Promise<{ draftId: string | null; text: string }> {
  if (!created) {
    return {
      draftId: saved.id,
      text: `Couldn't save the key: ${keyError}. The provider was kept; fix the key and retry.`,
    };
  }
  const rollbackError = await rollbackConnection(removeConnection, saved.id);
  if (rollbackError) {
    return {
      draftId: saved.id,
      text: `Couldn't save the key: ${keyError}. The provider row could not be removed: ${rollbackError}`,
    };
  }
  return {
    draftId: null,
    text: `Couldn't save the key: ${keyError}. The provider was not added.`,
  };
}

const PROVIDER_TILES: { id: ProviderKind; label: string }[] = [
  { id: "openrouter", label: "OpenRouter" },
  { id: "agentrouter", label: "Agent Router" },
  { id: "deepseek", label: "DeepSeek" },
  { id: "ollama-cloud", label: "Ollama Cloud" },
  { id: "ollama", label: "Ollama" },
  { id: "custom", label: "Custom" },
];

function firstIssueMessage(error: { issues: Array<{ message: string }> }): string {
  return error.issues[0]?.message ?? "Invalid provider";
}

function WelcomeStep({
  displayName,
  onName,
}: {
  displayName: string;
  onName: (value: string) => void;
}) {
  return (
    <>
      <Logo size={56} />
      <h1 className="m-0 font-serif text-[1.75rem] font-normal">Welcome to MyAgent</h1>
      <label className="flex w-full max-w-[300px] flex-col gap-1 text-left text-[13px] text-fg-3">
        What should I call you?
        <Input
          value={displayName}
          onChange={(e) => onName(e.target.value)}
          placeholder="Your name"
          autoComplete="given-name"
        />
      </label>
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0 text-left text-sm">
        <li className="flex items-center gap-2.5">
          <KeyRound size={16} className="text-accent-text" /> Bring your own keys
        </li>
        <li className="flex items-center gap-2.5">
          <ShieldCheck size={16} className="text-accent-text" /> Private by default
        </li>
        <li className="flex items-center gap-2.5">
          <Plug size={16} className="text-accent-text" /> Works with any OpenAI-compatible provider
        </li>
      </ul>
    </>
  );
}

function ProviderTiles({
  kind,
  onPick,
}: {
  kind: ProviderKind;
  onPick: (kind: ProviderKind) => void;
}) {
  return (
    <div className="flex flex-wrap justify-center gap-2.5">
      {PROVIDER_TILES.map((tile) => (
        <button
          key={tile.id}
          type="button"
          onClick={() => onPick(tile.id)}
          aria-pressed={kind === tile.id}
          className={cn(
            "flex w-[110px] flex-col items-center gap-1.5 rounded-card p-2 text-[13px] ring-1 ring-line hover:bg-fill-2",
            kind === tile.id ? "bg-accent-soft ring-2 ring-accent" : "bg-fill-1",
          )}
        >
          <ProviderIcon kind={tile.id} size={32} />
          {tile.label}
        </button>
      ))}
    </div>
  );
}

function ProviderKeyInput({
  kind,
  value,
  onChange,
}: {
  kind: ProviderKind;
  value: string;
  onChange: (value: string) => void;
}) {
  const keyless = KEYLESS_KINDS.has(kind);
  return (
    <label className="flex w-full max-w-[360px] flex-col gap-1 text-left text-[13px] text-fg-3">
      {keyless ? "No key needed" : "API key"}
      {keyless ? (
        <span className="text-[13px] text-fg-3">
          A local Ollama server accepts requests without a key.
        </span>
      ) : (
        <Input
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="sk-…"
          autoComplete="off"
        />
      )}
    </label>
  );
}

function ProviderStep({
  kind,
  baseUrl,
  keyValue,
  busy,
  connected,
  status,
  onPick,
  onBaseUrl,
  onKey,
  onConnect,
}: {
  kind: ProviderKind;
  baseUrl: string;
  keyValue: string;
  busy: boolean;
  connected: boolean;
  status: string | null;
  onPick: (kind: ProviderKind) => void;
  onBaseUrl: (value: string) => void;
  onKey: (value: string) => void;
  onConnect: () => void;
}) {
  return (
    <>
      <h2 className="m-0 text-xl font-semibold">Connect a provider</h2>
      <ProviderTiles kind={kind} onPick={onPick} />
      <ProviderKeyInput kind={kind} value={keyValue} onChange={onKey} />
      <label className="flex w-full max-w-[360px] flex-col gap-1 text-left text-[13px] text-fg-3">
        Base URL
        <Input value={baseUrl} onChange={(e) => onBaseUrl(e.target.value)} />
      </label>
      <Button variant="primary" disabled={busy} onClick={onConnect}>
        {busy ? <Spinner label="Testing…" /> : "Test & continue"}
      </Button>
      {connected && (
        <span className="flex items-center gap-1.5 text-sm font-semibold text-success">
          <Check size={16} /> Connected
        </span>
      )}
      {status && (
        <p className="m-0 text-[13px] text-fg-3" role="status">
          {status}
        </p>
      )}
    </>
  );
}

function ModelStep({
  models,
  model,
  onModel,
}: {
  models: string[];
  model: string;
  onModel: (value: string) => void;
}) {
  return (
    <>
      <h2 className="m-0 text-xl font-semibold">Pick a default model</h2>
      {models.length === 0 ? (
        <p className="text-sm text-fg-3">
          No provider connected. You can add one later in Settings.
        </p>
      ) : (
        <div className="flex max-h-64 w-full max-w-[360px] flex-col gap-2 overflow-y-auto">
          {models.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => onModel(id)}
              aria-pressed={model === id}
              className={cn(
                "rounded-card border border-line px-3 py-2.5 text-left text-sm hover:bg-fill-2",
                model === id && "border-accent",
              )}
            >
              {id}
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function SuggestionsStep({
  onSuggestion,
  searchKey,
  onSearchKey,
  onSaveSearchKey,
  searchStatus,
}: {
  onSuggestion: (text: string) => void;
  searchKey: string;
  onSearchKey: (value: string) => void;
  onSaveSearchKey: () => void;
  searchStatus: string | null;
}) {
  return (
    <>
      <h2 className="m-0 text-xl font-semibold">Try it</h2>
      <div className="grid w-full grid-cols-2 gap-2.5">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => onSuggestion(suggestion)}
            className="rounded-card border border-line bg-raised p-3 text-left text-sm hover:bg-fill-2"
          >
            {suggestion}
          </button>
        ))}
      </div>
      <label className="flex w-full max-w-[360px] flex-col gap-1 text-left text-[13px] text-fg-3">
        Web search key (optional, Tavily)
        <span className="flex gap-1.5">
          <Input
            type="password"
            value={searchKey}
            onChange={(e) => onSearchKey(e.target.value)}
            placeholder="tvly-…"
            aria-label="Tavily API key"
            autoComplete="off"
          />
          <Button variant="default" onClick={onSaveSearchKey}>
            Save
          </Button>
        </span>
      </label>
      {searchStatus && (
        <p className="m-0 text-[13px] text-fg-3" role="status">
          {searchStatus}
        </p>
      )}
    </>
  );
}

function StepDots({ step }: { step: number }) {
  return (
    <span className="flex flex-1 justify-center gap-1.5">
      {[0, 1, 2, 3].map((i) => (
        <span
          key={i}
          className={cn("h-2 w-2 rounded-full", i === step ? "bg-accent" : "bg-fill-3")}
        />
      ))}
    </span>
  );
}

function OnboardingFooter({
  step,
  onStep,
  onFinish,
}: {
  step: number;
  onStep: (step: number) => void;
  onFinish: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Button variant="default" onClick={onFinish}>
        Skip
      </Button>
      <StepDots step={step} />
      {step > 0 && (
        <Button variant="default" onClick={() => onStep(Math.max(0, step - 1))}>
          Back
        </Button>
      )}
      {step < 3 ? (
        <Button variant="primary" onClick={() => onStep(Math.min(3, step + 1))}>
          Next
        </Button>
      ) : (
        <Button variant="primary" onClick={onFinish}>
          Done
        </Button>
      )}
    </div>
  );
}

export function OnboardingDialog() {
  const {
    onboarded,
    completeOnboarding,
    saveConnection,
    removeConnection,
    selectConnection,
    models,
    model,
    setModel,
    setComposerDraft,
    displayName,
    setDisplayName,
  } = useApp();

  const [step, setStep] = useState(0);
  const [kind, setKind] = useState<ProviderKind>("openrouter");
  const [key, setKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URLS.openrouter);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [searchKey, setSearchKey] = useState("");
  const [searchStatus, setSearchStatus] = useState<string | null>(null);

  if (onboarded) return null;

  const finish = () => {
    completeOnboarding();
  };

  const saveSearchKey = async () => {
    if (!searchKey.trim()) return;
    try {
      const count = await api.addSearchKey(searchKey.trim());
      localStorage.setItem("searchKeyPromptDismissed", "1");
      setSearchStatus(`Search key saved (${count} stored).`);
      setSearchKey("");
    } catch (e) {
      setSearchStatus(errorText(e));
    }
  };

  const persistKey = async (
    saved: Connection,
    keyless: boolean,
    created: boolean,
  ): Promise<string | null> => {
    if (keyless) return null;
    try {
      await api.setApiKey(saved.id, key.trim());
      return null;
    } catch (e) {
      const failure = await persistKeyFailure(
        saved,
        errorText(e),
        created,
        removeConnection,
      );
      setDraftId(failure.draftId);
      return failure.text;
    }
  };

  const prepareConnect = (): { input: ConnectionInput; keyless: boolean } | null => {
    const keyless = KEYLESS_KINDS.has(kind);
    if (!keyless && !key.trim()) {
      setStatus("Enter an API key to continue.");
      return null;
    }
    const parsed = connectionInputSchema.safeParse({
      name: PROVIDER_LABELS[kind],
      kind,
      base_url: baseUrl.trim(),
      default_model: null,
    });
    if (!parsed.success) {
      setStatus(firstIssueMessage(parsed.error));
      return null;
    }
    return { input: parsed.data, keyless };
  };

  const verifyAndList = async (saved: Connection): Promise<string[]> => {
    await api.verifyProvider(saved.id, saved.kind);
    const found = await api.listModels(saved.id, saved.kind);
    if (found.length === 0) {
      throw new Error("No models found. Check the API key and base URL.");
    }
    return found;
  };

  const finishConnect = (saved: Connection, found: string[]) => {
    selectConnection(saved.id);
    setModel(found[0]);
    setDraftId(null);
    setConnected(true);
    setStatus(`Connected · ${found.length} models found`);
    setTimeout(() => setStep(2), 700);
  };

  const reportConnectFailure = (error: unknown, saved: Connection | null) => {
    const raw = errorText(error);
    setStatus(saved ? `Saved, but the connection test failed. ${raw}` : raw);
  };

  const connect = async () => {
    const prepared = prepareConnect();
    if (!prepared) return;
    setBusy(true);
    let saved: Connection | null = null;
    const existing = draftId;
    try {
      saved = await saveConnection(prepared.input, existing ?? undefined, {
        activate: false,
      });
      setDraftId(saved.id);
      const keyError = await persistKey(saved, prepared.keyless, !existing);
      if (keyError) {
        setStatus(keyError);
        return;
      }
      const found = await verifyAndList(saved);
      finishConnect(saved, found);
    } catch (e) {
      reportConnectFailure(e, saved);
    } finally {
      setBusy(false);
    }
  };

  const useSuggestion = (text: string) => {
    setComposerDraft(text);
    finish();
    setTimeout(() => document.getElementById("composer")?.focus(), 0);
  };

  return (
    <div className="fixed inset-x-0 bottom-0 top-8 z-[100] grid place-items-center bg-raised p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Welcome"
        className="flex min-h-[440px] w-full max-w-[720px] flex-col gap-3.5 rounded-composer bg-overlay p-8 shadow-[var(--shadow-lg)] ring-1 ring-line-strong"
      >
        <div className="flex flex-1 flex-col items-center gap-3 text-center">
          {step === 0 && (
            <WelcomeStep displayName={displayName} onName={setDisplayName} />
          )}
          {step === 1 && (
            <ProviderStep
              kind={kind}
              baseUrl={baseUrl}
              keyValue={key}
              busy={busy}
              connected={connected}
              status={status}
              onPick={(next) => {
                if (next !== kind) setDraftId(null);
                setKind(next);
                setBaseUrl(DEFAULT_BASE_URLS[next]);
                setConnected(false);
                setStatus(null);
              }}
              onBaseUrl={setBaseUrl}
              onKey={setKey}
              onConnect={() => void connect()}
            />
          )}
          {step === 2 && (
            <ModelStep models={models} model={model} onModel={setModel} />
          )}
          {step === 3 && (
            <SuggestionsStep
              onSuggestion={useSuggestion}
              searchKey={searchKey}
              onSearchKey={setSearchKey}
              onSaveSearchKey={() => void saveSearchKey()}
              searchStatus={searchStatus}
            />
          )}
        </div>

        <OnboardingFooter step={step} onStep={setStep} onFinish={finish} />
      </div>
    </div>
  );
}
