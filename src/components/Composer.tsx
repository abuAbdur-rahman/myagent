import { useEffect, useRef, useState } from "react";
import { ArrowUp, ChevronDown, Square } from "lucide-react";
import { useApp } from "../lib/store";
import { openModelPicker } from "./ModelPicker";
import { toast } from "../lib/toast";
import { cn } from "../lib/utils";

const SLASH_COMMANDS: [string, string][] = [
  ["new", "New chat"],
  ["clear", "Clear chat"],
  ["memory", "Open memory"],
  ["settings", "Open settings"],
];

const HISTORY_LIMIT = 50;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function shiftIndent(
  value: string,
  start: number,
  end: number,
  outdent: boolean,
): { value: string; start: number; end: number } {
  const lineStart = value.lastIndexOf("\n", start - 1) + 1;
  let lineEnd = value.indexOf("\n", end);
  if (lineEnd === -1) lineEnd = value.length;
  const lines = value.slice(lineStart, lineEnd).split("\n");
  let firstDelta = 0;
  const changed = lines.map((line, index) => {
    if (outdent) {
      const cut = line.startsWith("  ") ? 2 : line.startsWith(" ") ? 1 : 0;
      if (index === 0) firstDelta = -cut;
      return line.slice(cut);
    }
    if (index === 0) firstDelta = 2;
    return `  ${line}`;
  });
  const next = changed.join("\n");
  const totalDelta = next.length - (lineEnd - lineStart);
  return {
    value: value.slice(0, lineStart) + next + value.slice(lineEnd),
    start: Math.max(lineStart, start + firstDelta),
    end: Math.max(lineStart, end + totalDelta),
  };
}

function continueBlock(
  value: string,
  pos: number,
): { value: string; pos: number } | null {
  const lineStart = value.lastIndexOf("\n", pos - 1) + 1;
  const before = value.slice(lineStart, pos);
  const fences = (value.slice(0, pos).match(/```/g) || []).length;
  if (fences % 2 === 1) return null;

  const empty = before.match(/^(\s*)(-|\*|\d+\.|>)\s?$/);
  if (empty) {
    return { value: value.slice(0, lineStart) + value.slice(pos), pos: lineStart };
  }
  const item = before.match(/^(\s*)(-|\*|\d+\.|>)\s/);
  if (!item) return null;
  const [, indent, marker] = item;
  let next = marker;
  const numbered = marker.match(/^(\d+)\.$/);
  if (numbered) next = `${parseInt(numbered[1], 10) + 1}.`;
  const insert = `\n${indent}${next} `;
  return { value: value.slice(0, pos) + insert + value.slice(pos), pos: pos + insert.length };
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
  const historyRef = useRef<string[]>([]);
  const historyPos = useRef(-1);

  const slashMatch = composerDraft.match(/^\/(\w*)$/);
  const slashItems = slashMatch
    ? SLASH_COMMANDS.filter(([name]) => name.startsWith(slashMatch[1].toLowerCase()))
    : [];

  useEffect(() => {
    setSlashIndex(0);
  }, [composerDraft]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 22;
    el.style.height = `${Math.min(el.scrollHeight, lineHeight * 8)}px`;
  }, [composerDraft]);

  const canSend =
    !streaming && !!activeConnection && !!model && composerDraft.trim().length > 0;

  const submit = async () => {
    const text = composerDraft.trim();
    if (!canSend) return;
    try {
      const accepted = await sendMessage(text);
      if (accepted) {
        historyRef.current = [...historyRef.current.slice(-HISTORY_LIMIT + 1), text];
        historyPos.current = -1;
        setComposerDraft("");
      } else {
        toast("Couldn't send that message.");
      }
    } catch {
      toast("Couldn't send that message.");
    }
  };

  const runSlash = (name: string) => {
    setComposerDraft("");
    setSlashIndex(0);
    if (name === "new") void newConversation().catch(() => undefined);
    else if (name === "clear") void clearActiveConversation();
    else if (name === "memory") setSettingsPage("memory");
    else if (name === "settings") setSettingsPage("general");
  };

  const applyEdit = (next: string, start: number, end: number) => {
    setComposerDraft(next);
    requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(start, end);
    });
  };

  const wrap = (a: string, b?: string) => {
    const el = ref.current;
    if (!el) return;
    const end = b ?? a;
    const s = el.selectionStart ?? composerDraft.length;
    const e = el.selectionEnd ?? composerDraft.length;
    const next =
      composerDraft.slice(0, s) + a + composerDraft.slice(s, e) + end + composerDraft.slice(e);
    applyEdit(next, s + a.length, e + a.length);
  };

  const cycleHistory = (direction: 1 | -1) => {
    const history = historyRef.current;
    if (history.length === 0) return;
    let pos = historyPos.current;
    if (direction === 1) {
      pos = pos === -1 ? history.length - 1 : Math.max(0, pos - 1);
    } else if (pos !== -1) {
      pos = pos + 1;
      if (pos >= history.length) pos = -1;
    } else {
      return;
    }
    historyPos.current = pos;
    setComposerDraft(pos === -1 ? "" : history[pos]);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const el = ref.current;
      if (!el) return;
      const start = el.selectionStart ?? 0;
      const end = el.selectionEnd ?? 0;
      const next = shiftIndent(composerDraft, start, end, e.shiftKey);
      applyEdit(next.value, next.start, next.end);
      return;
    }
    if (
      (e.key === "ArrowUp" || e.key === "ArrowDown") &&
      composerDraft === "" &&
      slashItems.length === 0
    ) {
      e.preventDefault();
      cycleHistory(e.key === "ArrowUp" ? 1 : -1);
      return;
    }
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
        runSlash(slashItems[Math.min(slashIndex, slashItems.length - 1)][0]);
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
      if (e.shiftKey && sendWith === "enter") return;
      if (!e.shiftKey && sendWith === "enter") {
        e.preventDefault();
        const el = ref.current;
        const pos = el?.selectionStart ?? composerDraft.length;
        const continued = continueBlock(composerDraft, pos);
        if (continued) {
          applyEdit(continued.value, continued.pos, continued.pos);
        } else if (!streaming) {
          void submit();
        }
        return;
      }
      if (sendWith === "ctrl") {
        if (e.ctrlKey) {
          e.preventDefault();
          if (!streaming) void submit();
        }
        return;
      }
    }
    if (e.key === "Escape" && !e.ctrlKey && !e.metaKey) {
      if (streaming) {
        e.preventDefault();
        stopStream();
      }
    }
  };

  const modelLabel =
    activeConnection && model ? `${activeConnection.name} · ${model}` : "Select model";

  return (
    <div>
      <div className="relative rounded-composer border border-border bg-surface-2 px-2.5 pb-2 pt-2 focus-within:border-accent">
        <SlashMenu items={slashItems} index={slashIndex} onPick={runSlash} />
        <textarea
          id="composer"
          ref={ref}
          rows={1}
          value={composerDraft}
          onChange={(e) => {
            historyPos.current = -1;
            setComposerDraft(e.target.value);
          }}
          onKeyDown={onKeyDown}
          aria-label="Message"
          placeholder="Message MyAgent… (Markdown supported, / for commands)"
          className="block max-h-[200px] w-full resize-none border-0 bg-transparent px-0.5 py-1 text-[15px] leading-6 outline-none placeholder:text-muted"
        />
        <div className="mt-1 flex items-center gap-1">
          <button
            type="button"
            onClick={(e) => openModelPicker(e.currentTarget)}
            aria-label="Choose model"
            title={modelLabel}
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
              disabled={!canSend}
              className="grid h-8 w-8 flex-none place-items-center rounded-full bg-accent text-accent-contrast disabled:bg-active disabled:text-muted"
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>
      </div>
      <div className="mt-1.5 text-center text-xs text-muted">
        MyAgent can make mistakes. Check important info.
      </div>
    </div>
  );
}
