import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { useApp } from "../lib/store";
import * as api from "../lib/api";
import { SEARCH_KEY_ACCOUNT } from "../lib/api";
import { Button, Input } from "./ui";
import { errorText } from "../lib/utils";

const DISMISS_KEY = "searchKeyPromptDismissed";

export function SearchKeyDialog() {
  const { onboarded } = useApp();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!onboarded) return;
    if (localStorage.getItem(DISMISS_KEY) === "1") return;
    let live = true;
    api
      .hasApiKey(SEARCH_KEY_ACCOUNT)
      .then((has) => {
        if (live && !has) setOpen(true);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [onboarded]);

  if (!open) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setOpen(false);
  };

  const save = async () => {
    if (!key.trim()) {
      setStatus("Enter a Tavily API key.");
      return;
    }
    setBusy(true);
    try {
      await api.addSearchKey(key.trim());
      localStorage.setItem(DISMISS_KEY, "1");
      setOpen(false);
    } catch (e) {
      setStatus(errorText(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100] grid place-items-center bg-black/40 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add a web search key"
        className="flex w-full max-w-[420px] flex-col gap-3 rounded-composer border border-border bg-surface p-6 shadow-[var(--shadow)]"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="m-0 flex items-center gap-2 text-lg font-semibold">
          <KeyRound size={18} className="text-accent" /> Turn on web search
        </h2>
        <p className="m-0 text-sm text-muted">
          Web search uses your own Tavily key. It stays in Windows Credential Manager and never
          reaches the page. Skip this and enable it later in Settings → Search.
        </p>
        <Input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="tvly-…"
          aria-label="Tavily API key"
          autoComplete="off"
        />
        {status && (
          <p className="m-0 text-xs text-danger" role="status">
            {status}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="default" onClick={dismiss}>
            Not now
          </Button>
          <Button variant="primary" disabled={busy} onClick={() => void save()}>
            Save key
          </Button>
        </div>
      </div>
    </div>
  );
}
