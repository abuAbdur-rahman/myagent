import { useEffect, useRef, useState } from "react";
import { ArrowUp, ChevronDown, Square } from "lucide-react";
import { useApp } from "../lib/store";
import { openModelPicker } from "./ModelPicker";
import { cn } from "../lib/utils";

const SLASH_COMMANDS: [string, string][] = [
  ["new", "New chat"],
  ["clear", "Clear chat"],
  ["memory", "Open memory"],
  ["settings", "Open settings"],
];

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function SlashMenu({
  items,
  index,
  onPick,
}: {
  items: [string, string][];
  index: number;
  onPick: (name: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="absolute bottom-full left-2 z-10 mb-1.5 min-w-[260px] rounded-card border border-border bg-surface p-1 shadow-[var(--shadow)]">
      {items.map(([name, label], i) => (
        <button
          key={name}
          type="button"
          onClick={() => onPick(name)}
          className={cn(
            "flex w-full items-center gap-2 rounded-control px-2.5 py-1.5 text-left text-sm",
            i === index && "bg-active",
          )}
        >
          <b className="font-mono text-[13px]">/{name}</b>
          <span className="text-muted">{label}</span>
        </button>
      ))}
    </div>
  );
}

export function Composer() {
  const {
    composerDraft,
    setComposerDraft,
    sendMessage,
    stopStream,
    streaming,
    sendWith,
    activeConnection,
    model,
    clearActiveConversation,
    setSettingsPage,
    newConversation,
  } = useApp();
  const ref = useRef<HTMLTextAreaElement>(null);
  const [slashIndex, setSlashIndex] = useState(0);

  const slashMatch = composerDraft.match(/^\/(\w*)$/);
  const slashItems = slashMatch
    ? SLASH_COMMANDS.filter(([name]) =>
        name.startsWith(slashMatch[1].toLowerCase()),
      )
    : [];

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 22;
    el.style.height = `${Math.min(el.scrollHeight, lineHeight * 8)}px`;
  }, [composerDraft]);

  const canSend =
    (composerDraft.trim().length > 0 && !!activeConnection && !!model && !streaming) ||
    streaming;

  const submit = async () => {
    const text = composerDraft.trim();
    if (!text || streaming) return;
    if (!activeConnection || !model) return;
    setComposerDraft("");
    await sendMessage(text);
  };

  const runSlash = (name: string) => {
    setComposerDraft("");
    setSlashIndex(0);
    if (name === "new") void newConversation().catch(() => undefined);
    else if (name === "clear") void clearActiveConversation();
    else if (name === "memory") setSettingsPage("memory");
    else if (name === "settings") setSettingsPage("general");
  };

  const openPicker = (anchor: HTMLElement) => {
    openModelPicker(anchor);
  };

  const modelLabel =
    activeConnection && model ? `${activeConnection.name} · ${model}` : "Select model";

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashItems.length > 0) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex(
          (i) => (i + (e.key === "ArrowDown" ? 1 : -1) + slashItems.length) % slashItems.length,
        );
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        runSlash(slashItems[slashIndex][0]);
        return;
      }
      if (e.key === "Escape") {
        setComposerDraft("");
        return;
      }
    }
    if (e.ctrlKey && !e.altKey) {
      const k = e.key.toLowerCase();
      if (k === "b") {
        e.preventDefault();
        wrap("**");
        return;
      }
      if (k === "i") {
        e.preventDefault();
        wrap("*");
        return;
      }
      if (k === "e") {
        e.preventDefault();
        wrap("`");
        return;
      }
    }
    if (e.key === "Enter" && !e.nativeEvent.isComposing) {
      const go = sendWith === "ctrl" ? e.ctrlKey : !e.shiftKey;
      if (go) {
        e.preventDefault();
        if (!streaming) void submit();
      }
    }
  };

  const wrap = (a: string, b?: string) => {
    const el = ref.current;
    if (!el) return;
    const end = b ?? a;
    const s = el.selectionStart ?? composerDraft.length;
    const e = el.selectionEnd ?? composerDraft.length;
    const next =
      composerDraft.slice(0, s) + a + composerDraft.slice(s, e) + end + composerDraft.slice(e);
    setComposerDraft(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + a.length, e + a.length);
    });
  };

  return (
    <div>
      <div className="relative rounded-composer border border-border bg-surface-2 px-2.5 pb-2 pt-2 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent">
        <SlashMenu
          items={slashItems}
          index={slashIndex}
          onPick={runSlash}
        />
        <textarea
          id="composer"
          ref={ref}
          rows={1}
          value={composerDraft}
          onChange={(e) => setComposerDraft(e.target.value)}
          onKeyDown={onKeyDown}
          aria-label="Message"
          placeholder="Message myagent… (Markdown supported, / for commands)"
          className="block max-h-[200px] w-full resize-none border-0 bg-transparent px-0.5 py-1 text-[15px] leading-6 outline-none placeholder:text-muted"
        />
        <div className="mt-1 flex items-center gap-1">
          <button
            type="button"
            onClick={(e) => openPicker(e.currentTarget)}
            aria-label="Choose model"
            className="flex h-7 max-w-[260px] items-center gap-1 truncate rounded-control border border-border bg-surface px-2 text-[13px] hover:bg-hover"
          >
            <span className="truncate">{modelLabel}</span>
            <ChevronDown size={14} className="flex-none text-muted" />
          </button>
          <span className="flex-1" />
          <span className="text-xs text-muted">{estimateTokens(composerDraft)} tokens</span>
          {streaming ? (
            <button
              type="button"
              onClick={stopStream}
              aria-label="Stop (Esc)"
              title="Stop (Esc)"
              className="grid h-8 w-8 flex-none place-items-center rounded-full bg-accent text-accent-contrast"
            >
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void submit()}
              aria-label="Send"
              disabled={!canSend || !composerDraft.trim()}
              className="grid h-8 w-8 flex-none place-items-center rounded-full bg-accent text-accent-contrast disabled:bg-active disabled:text-muted"
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>
      </div>
      <div className="mt-1.5 text-center text-xs text-muted">
        myagent can make mistakes. Check important info.
      </div>
    </div>
  );
}
