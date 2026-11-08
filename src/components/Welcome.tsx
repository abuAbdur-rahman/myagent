import { Code2, Lightbulb, ListChecks, Pencil } from "lucide-react";
import { useApp } from "../lib/store";
import { Composer } from "./Composer";
import { Logo } from "./Logo";

const SUGGESTIONS = [
  { label: "Explain a concept", icon: Lightbulb },
  { label: "Draft an email", icon: Pencil },
  { label: "Debug my code", icon: Code2 },
  { label: "Plan a project", icon: ListChecks },
];

function greeting(name: string): string {
  const who = name.trim() || "there";
  const hour = new Date().getHours();
  if (hour >= 18) return "Evening thoughts";
  if (hour < 12) return `Good morning, ${who}`;
  return `Good afternoon, ${who}`;
}

export function Welcome() {
  const { displayName, setComposerText } = useApp();
  const heading = displayName ? `Hey there, ${displayName}` : greeting("");

  const pick = (text: string) => {
    setComposerText(text);
    setTimeout(() => document.getElementById("composer")?.focus(), 0);
  };

  return (
    <div className="flex h-full flex-col items-center justify-center overflow-auto px-6 pb-[8vh]">
      <div className="w-full max-w-[760px] text-center">
        <Logo size={44} className="mx-auto rounded-[14px]" />
        <h1 className="mb-1.5 mt-5 font-serif text-[1.75rem] font-normal leading-tight">
          {heading}
        </h1>
        <p className="mb-7 text-fg-3">What can I help with?</p>
        <div className="text-left">
          <Composer autoFocus />
        </div>
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {SUGGESTIONS.map((suggestion) => {
            const Icon = suggestion.icon;
            return (
              <button
                key={suggestion.label}
                type="button"
                onClick={() => pick(suggestion.label)}
                className="flex h-8 items-center gap-1.5 rounded-full px-3.5 text-[13px] text-fg-2 shadow-[inset_0_0_0_1px_var(--line)] hover:bg-fill-2 hover:text-fg"
              >
                <Icon size={14} className="text-fg-3" />
                {suggestion.label}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
