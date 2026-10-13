import { Asterisk } from "lucide-react";
import { useApp } from "../lib/store";
import { Composer } from "./Composer";

const SUGGESTIONS = ["Explain a concept", "Draft an email", "Debug my code", "Plan a project"];

function greeting(name: string): string {
  const who = name.trim() || "there";
  const hour = new Date().getHours();
  if (hour >= 18) return "Evening thoughts";
  if (hour < 12) return `Good morning, ${who}`;
  return `Good afternoon, ${who}`;
}

export function Welcome() {
  const { displayName, setComposerDraft } = useApp();
  const heading = displayName ? `Hey there, ${displayName}` : greeting("");

  const pick = (text: string) => {
    setComposerDraft(text);
    setTimeout(() => document.getElementById("composer")?.focus(), 0);
  };

  return (
    <div className="flex h-full place-items-center justify-center overflow-auto p-4">
      <div className="w-full max-w-[720px] text-center">
        <div className="inline-grid h-12 w-12 place-items-center rounded-full bg-accent text-accent-contrast">
          <Asterisk size={24} aria-hidden="true" />
        </div>
        <h1 className="mb-1 mt-2.5 font-serif text-[28px] font-semibold">
          {heading}
        </h1>
        <p className="mb-5 text-muted">What can I help with?</p>
        <div className="text-left">
          <Composer />
        </div>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => pick(suggestion)}
              className="h-8 rounded border border-border bg-surface px-3.5 text-[13px] hover:bg-hover"
            >
              {suggestion}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
