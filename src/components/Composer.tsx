import { useMemo, useRef, useState } from "react";
import { ArrowUp, ChevronDown, Square } from "lucide-react";
import { useApp } from "../lib/store";
import { openModelPicker } from "./ModelPicker";
import { toast } from "../lib/toast";
import { cn } from "../lib/utils";
import { TipTapEditor, type TipTapHandle } from "./composer/TipTapEditor";
import type { ChatKeyCallbacks } from "./composer/chatKeys";

const SLASH_COMMANDS: [string, string][] = [
  ["new", "New chat"],
  ["clear", "Clear chat"],
  ["compact", "Compact context now"],
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

export function Composer({ autoFocus }: { autoFocus?: boolean }) {
  const {
    composerDraft,
    setComposerDraft,
    composerSignal,
    sendMessage,
    stopStream,
    streaming,
    sendWith,
    activeConnection,
    model,
    messages,
    clearActiveConversation,
    setSettingsPage,
    newConversation,
    compactActive,
    reasoningEffort,
    setReasoningEffort,
    supportedEfforts,
  } = useApp();
  const editorRef = useRef<TipTapHandle | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);

  const slashMatch = composerDraft.match(/^\/(\w*)$/);
  const slashItems = slashMatch
    ? SLASH_COMMANDS.filter(([name]) => name.startsWith(slashMatch[1].toLowerCase()))
    : [];

  const historyEntries = useMemo(() => {
    const users = messages
      .filter((m) => m.role === "user")
      .map((m) => m.content.trim())
      .filter((text) => text.length > 0)
      .reverse();
    return users.filter((text, i) => i === 0 || text !== users[i - 1]);
  }, [messages]);

  const canSend =
    !streaming && !!activeConnection && !!model && composerDraft.trim().length > 0;

  const submit = () => {
    const handle = editorRef.current;
    const text = (handle?.getMarkdown() ?? composerDraft).trim();
    if (!text || streaming || !activeConnection || !model) return;
    handle?.clear();
    setComposerDraft("");
    setSlashIndex(0);
    if (text === "/compact") {
      handle?.focus();
      void compactActive().catch(() => undefined);
      return;
    }
    handle?.focus();
    void sendMessage(text).then((accepted) => {
      if (!accepted) {
        handle?.setMarkdown(text);
        setComposerDraft(text);
        toast("Couldn't send that message.");
      }
    });
  };

  const submitRef = useRef(submit);
  submitRef.current = submit;
  const stateRef = useRef({ streaming, sendWith, slashItems, historyEntries });
  stateRef.current = { streaming, sendWith, slashItems, historyEntries };
  const actionsRef = useRef({
    stopStream,
    runSlash: (_name: string) => {},
  });
  actionsRef.current.stopStream = stopStream;

  const runSlash = (name: string) => {
    editorRef.current?.clear();
    setComposerDraft("");
    setSlashIndex(0);
    if (name === "new") void newConversation().catch(() => undefined);
    else if (name === "clear") void clearActiveConversation();
    else if (name === "compact") void compactActive().catch(() => undefined);
    else if (name === "memory") setSettingsPage("memory");
    else if (name === "settings") setSettingsPage("general");
  };
  actionsRef.current.runSlash = runSlash;

  const chat = useMemo<ChatKeyCallbacks>(
    () => ({
      send: () => submitRef.current(),
      onEscape: () => {
        if (stateRef.current.streaming) {
          actionsRef.current.stopStream();
          return true;
        }
        return false;
      },
      isPopupOpen: () => stateRef.current.slashItems.length > 0,
      sendOnEnter: () => stateRef.current.sendWith === "enter",
      historyEntries: () => stateRef.current.historyEntries,
    }),
    [],
  );

  const slashIndexRef = useRef(slashIndex);
  slashIndexRef.current = slashIndex;
  const keyDownRef = useRef((_event: KeyboardEvent): boolean => false);
  keyDownRef.current = (event) => {
    const items = stateRef.current.slashItems;
    if (items.length === 0) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setSlashIndex((i) =>
        event.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length,
      );
      return true;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const clamped = Math.min(slashIndexRef.current, Math.max(0, items.length - 1));
      actionsRef.current.runSlash(items[clamped][0]);
      return true;
    }
    if (event.key === "Escape") {
      setComposerDraft("");
      editorRef.current?.clear();
      return true;
    }
    return false;
  };

  const modelLabel =
    activeConnection && model ? `${activeConnection.name} · ${model}` : "Select model";

  return (
    <div>
      <div className="composer relative rounded-composer border border-border bg-surface-2 px-2.5 pb-2 pt-2 focus-within:border-accent/70">
        <SlashMenu
          items={slashItems}
          index={Math.min(slashIndex, Math.max(0, slashItems.length - 1))}
          onPick={runSlash}
        />
        <TipTapEditor
          placeholder="Message MyAgent… (Markdown supported, / for commands)"
          autoFocus={autoFocus}
          signal={composerSignal}
          handleRef={editorRef}
          onChangeMarkdown={(markdown) => {
            setComposerDraft(markdown);
            setSlashIndex(0);
          }}
          chat={chat}
          onKeyDown={(event) => keyDownRef.current(event)}
        />
        <div className="mt-1 flex items-center gap-1">
          <button
            type="button"
            onClick={(e) => {
              openModelPicker(e.currentTarget);
              setTimeout(() => editorRef.current?.focus(), 0);
            }}
            aria-label="Choose model"
            title={modelLabel}
            className="flex h-7 max-w-[260px] items-center gap-1 truncate rounded-control border border-border bg-surface px-2 text-[13px] hover:bg-hover"
          >
            <span className="truncate">{modelLabel}</span>
            <ChevronDown size={14} className="flex-none text-muted" />
          </button>
          <select
            value={reasoningEffort ?? "none"}
            onChange={(e) =>
              setReasoningEffort(e.target.value === "none" ? null : e.target.value)
            }
            aria-label="Reasoning effort"
            title={
              supportedEfforts
                ? "Reasoning effort for this model"
                : "This model does not advertise reasoning levels"
            }
            disabled={!supportedEfforts}
            className="h-7 w-24 flex-none rounded-control border border-border bg-surface px-1.5 text-xs text-text disabled:opacity-50"
          >
            {(supportedEfforts ?? ["none"]).map((level) => (
              <option key={level} value={level}>
                {level === "none" ? "No reasoning" : level}
              </option>
            ))}
          </select>
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
              onClick={() => submitRef.current()}
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
