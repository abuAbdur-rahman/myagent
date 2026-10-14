import { useRef, useState } from "react";
import { ArrowUp, ChevronDown, Square } from "lucide-react";
import type { LexicalEditor } from "lexical";
import { useApp } from "../lib/store";
import { openModelPicker } from "./ModelPicker";
import { toast } from "../lib/toast";
import { cn } from "../lib/utils";
import {
  MarkdownEditor,
  clearEditor,
  focusEditor,
  getEditorMarkdown,
  setEditorMarkdown,
} from "./composer/MarkdownEditor";

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
    clearActiveConversation,
    setSettingsPage,
    newConversation,
    reasoningEffort,
    setReasoningEffort,
    supportedEfforts,
  } = useApp();
  const editorRef = useRef<LexicalEditor | null>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const historyRef = useRef<string[]>([]);
  const historyPos = useRef(-1);

  const slashMatch = composerDraft.match(/^\/(\w*)$/);
  const slashItems = slashMatch
    ? SLASH_COMMANDS.filter(([name]) => name.startsWith(slashMatch[1].toLowerCase()))
    : [];

  const canSend =
    !streaming && !!activeConnection && !!model && composerDraft.trim().length > 0;

  const submit = async () => {
    const text = getEditorMarkdown(editorRef.current).trim() || composerDraft.trim();
    if (!text || streaming) return;
    if (!activeConnection || !model) return;
    try {
      const accepted = await sendMessage(text);
      if (accepted) {
        historyRef.current = [...historyRef.current.slice(-HISTORY_LIMIT + 1), text];
        historyPos.current = -1;
        clearEditor(editorRef.current);
        setComposerDraft("");
      } else {
        toast("Couldn't send that message.");
      }
    } catch {
      toast("Couldn't send that message.");
    }
  };

  const runSlash = (name: string) => {
    clearEditor(editorRef.current);
    setComposerDraft("");
    setSlashIndex(0);
    if (name === "new") void newConversation().catch(() => undefined);
    else if (name === "clear") void clearActiveConversation();
    else if (name === "memory") setSettingsPage("memory");
    else if (name === "settings") setSettingsPage("general");
  };

  const recall = (direction: 1 | -1) => {
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
    const text = pos === -1 ? "" : history[pos];
    setEditorMarkdown(editorRef.current, text);
    setComposerDraft(text);
  };

  const modelLabel =
    activeConnection && model ? `${activeConnection.name} · ${model}` : "Select model";

  return (
    <div>
      <div className="relative rounded-composer border border-border bg-surface-2 px-2.5 pb-2 pt-2 focus-within:border-accent/70">
        <SlashMenu
          items={slashItems}
          index={Math.min(slashIndex, Math.max(0, slashItems.length - 1))}
          onPick={runSlash}
        />
        <MarkdownEditor
          placeholder="Message MyAgent… (Markdown supported, / for commands)"
          autoFocus={autoFocus}
          signal={composerSignal}
          editorRef={editorRef}
          onChangeMarkdown={(markdown) => {
            historyPos.current = -1;
            setComposerDraft(markdown);
            setSlashIndex(0);
          }}
          handlers={{
            onSend: () => void submit(),
            shouldSend: (mods) =>
              sendWith === "enter" ? !mods.shiftKey : !!(mods.ctrlKey || mods.metaKey),
            onEscape: () => {
              if (streaming) stopStream();
            },
            onEmptyArrow: (direction) => recall(direction),
            onBeforeEnter: () => {
              if (slashItems.length === 0) return false;
              runSlash(slashItems[Math.min(slashIndex, slashItems.length - 1)][0]);
              return true;
            },
          }}
        />
        <div className="mt-1 flex items-center gap-1">
          <button
            type="button"
            onClick={(e) => {
              openModelPicker(e.currentTarget);
              setTimeout(() => focusEditor(editorRef.current), 0);
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
