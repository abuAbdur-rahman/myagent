import { useState } from "react";
import { Check, KeyRound, Plug, ShieldCheck } from "lucide-react";
import { Logo } from "./Logo";
import { useApp } from "../lib/store";
import * as api from "../lib/api";
import { DEFAULT_BASE_URLS, connectionInputSchema, type ProviderKind } from "../lib/types";
import { Button, Input, Spinner } from "./ui";
import { errorText } from "../lib/utils";
import { cn } from "../lib/utils";

const SUGGESTIONS = [
  "Explain how closures work in JavaScript",
  "Draft a friendly email to a new client",
  "Debug a slow SQL query",
  "Plan a two-week learning roadmap",
];

const PROVIDER_TILES: { id: ProviderKind; label: string; initials: string }[] = [
  { id: "openrouter", label: "OpenRouter", initials: "OR" },
  { id: "agentrouter", label: "Agent Router", initials: "AR" },
  { id: "custom", label: "Custom", initials: "CU" },
];

const PROVIDER_NAMES: Record<ProviderKind, string> = {
  openrouter: "OpenRouter",
  agentrouter: "Agent Router",
  custom: "Custom",
};

export function OnboardingDialog() {
  const {
    onboarded,
    completeOnboarding,
    saveConnection,
    refreshModels,
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

  if (onboarded) return null;

  const finish = () => {
    completeOnboarding();
  };

  const connect = async () => {
    if (!key.trim()) {
      setStatus("Enter an API key to continue.");
      return;
    }
    const parsed = connectionInputSchema.safeParse({
      name: PROVIDER_NAMES[kind],
      kind,
      base_url: baseUrl.trim(),
      default_model: null,
    });
    if (!parsed.success) {
      setStatus(parsed.error.issues[0]?.message ?? "Invalid provider");
      return;
    }
    setBusy(true);
    try {
      const saved = await saveConnection(parsed.data);
      await api.setApiKey(saved.id, key.trim());
      const found = await api.listModels(saved.base_url, saved.id);
      if (found.length > 0) setModel(found[0]);
      await refreshModels();
      setConnected(true);
      setStatus(`Connected · ${found.length} models found`);
      setTimeout(() => setStep(2), 700);
    } catch (e) {
      setStatus(errorText(e));
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
    <div className="fixed inset-x-0 bottom-0 top-8 z-[100] grid place-items-center bg-surface p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Welcome"
        className="flex min-h-[440px] w-full max-w-[720px] flex-col gap-3.5 rounded-composer border border-border bg-surface p-8"
      >
        <div className="flex flex-1 flex-col items-center gap-3 text-center">
          {step === 0 && (
            <>
              <Logo size={56} />
              <h1 className="m-0 font-serif text-[28px] font-semibold">Welcome to MyAgent</h1>
              <label className="flex w-full max-w-[300px] flex-col gap-1 text-left text-xs text-muted">
                What should I call you?
                <Input
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Your name"
                  autoComplete="given-name"
                />
              </label>
              <ul className="m-0 flex list-none flex-col gap-2.5 p-0 text-left text-sm">
                <li className="flex items-center gap-2.5">
                  <KeyRound size={16} className="text-accent" /> Bring your own keys
                </li>
                <li className="flex items-center gap-2.5">
                  <ShieldCheck size={16} className="text-accent" /> Private by default
                </li>
                <li className="flex items-center gap-2.5">
                  <Plug size={16} className="text-accent" /> Works with any OpenAI-compatible provider
                </li>
              </ul>
            </>
          )}

          {step === 1 && (
            <>
              <h2 className="m-0 text-xl font-semibold">Connect a provider</h2>
              <div className="flex flex-wrap justify-center gap-2.5">
                {PROVIDER_TILES.map((tile) => (
                  <button
                    key={tile.id}
                    type="button"
                    onClick={() => {
                      setKind(tile.id);
                      setBaseUrl(DEFAULT_BASE_URLS[tile.id]);
                      setConnected(false);
                      setStatus(null);
                    }}
                    aria-pressed={kind === tile.id}
                    className={cn(
                      "flex w-[110px] flex-col items-center gap-1.5 rounded-card border-2 bg-surface p-2 hover:bg-hover",
                      kind === tile.id ? "border-accent" : "border-border",
                    )}
                  >
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-accent text-xs font-semibold text-accent-contrast">
                      {tile.initials}
                    </span>
                    {tile.label}
                  </button>
                ))}
              </div>
              <label className="flex w-full max-w-[360px] flex-col gap-1 text-left text-xs text-muted">
                API key
                <Input
                  type="password"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="sk-…"
                  autoComplete="off"
                />
              </label>
              <label className="flex w-full max-w-[360px] flex-col gap-1 text-left text-xs text-muted">
                Base URL
                <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
              </label>
              <Button variant="primary" disabled={busy} onClick={() => void connect()}>
                {busy ? <Spinner label="Testing…" /> : "Test & continue"}
              </Button>
              {connected && (
                <span className="flex items-center gap-1.5 text-sm font-semibold text-success">
                  <Check size={16} /> Connected
                </span>
              )}
              {status && (
                <p className="m-0 text-xs text-muted" role="status">
                  {status}
                </p>
              )}
            </>
          )}

          {step === 2 && (
            <>
              <h2 className="m-0 text-xl font-semibold">Pick a default model</h2>
              {models.length === 0 ? (
                <p className="text-sm text-muted">
                  No provider connected. You can add one later in Settings.
                </p>
              ) : (
                <div className="flex max-h-64 w-full max-w-[360px] flex-col gap-2 overflow-y-auto">
                  {models.map((id) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setModel(id)}
                      aria-pressed={model === id}
                      className={cn(
                        "rounded-card border border-border px-3 py-2.5 text-left text-sm hover:bg-hover",
                        model === id && "border-accent",
                      )}
                    >
                      {id}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {step === 3 && (
            <>
              <h2 className="m-0 text-xl font-semibold">Try it</h2>
              <div className="grid w-full grid-cols-2 gap-2.5">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => useSuggestion(suggestion)}
                    className="rounded-card border border-border bg-surface p-3 text-left text-sm hover:bg-hover"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button variant="default" onClick={finish}>
            Skip
          </Button>
          <span className="flex flex-1 justify-center gap-1.5">
            {[0, 1, 2, 3].map((i) => (
              <span
                key={i}
                className={cn("h-2 w-2 rounded-full", i === step ? "bg-accent" : "bg-active")}
              />
            ))}
          </span>
          {step > 0 && (
            <Button variant="default" onClick={() => setStep((s) => Math.max(0, s - 1))}>
              Back
            </Button>
          )}
          {step < 3 ? (
            <Button variant="primary" onClick={() => setStep((s) => Math.min(3, s + 1))}>
              Next
            </Button>
          ) : (
            <Button variant="primary" onClick={finish}>
              Done
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
