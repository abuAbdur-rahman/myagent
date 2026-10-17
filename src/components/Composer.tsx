import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, ChevronDown, Paperclip, Square, X } from "lucide-react";
import { useApp } from "../lib/store";
import { ModelPickerHost, openModelPicker } from "./ModelPicker";
import { Select } from "./ui/select";
import { toast } from "../lib/toast";
import { cn, downloadText } from "../lib/utils";
import { buildChatExport, conversationToMarkdown, safeFilename } from "../lib/export";
import {
  dispatchSlash,
  expandFileCommand,
  matchSlash,
  mergeSlashCommands,
  parseSlash,
  resolveExportFormat,
  resolveModelArg,
  type SlashCommand,
} from "../lib/slash";
import { TipTapEditor, type TipTapHandle } from "./composer/TipTapEditor";
import type { ChatKeyCallbacks } from "./composer/chatKeys";
import { buildAttachmentSend, ingestDoc, isSupportedMime } from "../lib/knowledge";
import { downscaleImage, isSupportedImage } from "../lib/image";

const MAX_ATTACH_BYTES = 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const TEXT_EXTENSIONS: Record<string, string> = {
  md: "text/markdown",
  markdown: "text/markdown",
  txt: "text/plain",
  json: "application/json",
  yml: "application/yaml",
  yaml: "application/yaml",
  xml: "application/xml",
  csv: "text/csv",
  html: "text/html",
  css: "text/css",
  js: "application/javascript",
  jsx: "application/javascript",
  ts: "application/typescript",
  tsx: "application/typescript",
  toml: "text/plain",
  ini: "text/plain",
  log: "text/plain",
  sh: "text/plain",
  ps1: "text/plain",
  py: "text/plain",
  rs: "text/plain",
  go: "text/plain",
  java: "text/plain",
  c: "text/plain",
  cpp: "text/plain",
  h: "text/plain",
};

function mimeForFile(name: string, declared: string): string {
  if (declared) return declared;
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "";
  const ext = name.slice(dot + 1).toLowerCase();
  return TEXT_EXTENSIONS[ext] ?? "";
}

interface AttachChip {
  key: string;
  kind: "file" | "image";
  name: string;
  excerpt: string;
  dataUrl?: string;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function SlashMenu({
  items,
  index,
  onPick,
}: {
  items: SlashCommand[];
  index: number;
  onPick: (name: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="absolute bottom-full left-2 z-10 mb-1.5 min-w-[260px] rounded-card border border-border bg-surface p-1 shadow-[var(--shadow)]">
      {items.map((command, i) => (
        <button
          key={command.name}
          type="button"
          onClick={() => onPick(command.name)}
          className={cn(
            "flex w-full items-center gap-2 rounded-control px-2.5 py-1.5 text-left text-sm",
            i === index && "bg-active",
          )}
        >
          <b className="font-mono text-[13px]">
            /{command.name}
            {command.hint ? ` ${command.hint}` : ""}
          </b>
          <span className="text-muted">{command.label}</span>
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
    activeProject,
    model,
    models,
    setModel,
    messages,
    conversations,
    activeConversationId,
    clearActiveConversation,
    setSettingsPage,
    newConversation,
    compactActive,
    reasoningEffort,
    setReasoningEffort,
    supportedEfforts,
    fileCommands,
    loadFileCommands,
  } = useApp();
  const editorRef = useRef<TipTapHandle | null>(null);
  const modelButtonRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [chips, setChips] = useState<AttachChip[]>([]);
  const [attaching, setAttaching] = useState(false);
  const chipsRef = useRef(chips);
  chipsRef.current = chips;

  const concreteDraft = (editorRef.current?.getMarkdown() ?? composerDraft).trim();
  const mergedCommands = useMemo(() => mergeSlashCommands(fileCommands), [fileCommands]);
  const slashItems = /^\/[\w-]*$/.test(concreteDraft) ? matchSlash(concreteDraft, mergedCommands) : [];

  useEffect(() => {
    const onFocus = () => void loadFileCommands();
    window.addEventListener("focus", onFocus);
    void loadFileCommands();
    return () => window.removeEventListener("focus", onFocus);
  }, [loadFileCommands]);

  const menuOpenRef = useRef(false);
  useEffect(() => {
    const open = slashItems.length > 0;
    if (open && !menuOpenRef.current) void loadFileCommands();
    menuOpenRef.current = open;
  }, [slashItems.length, loadFileCommands]);

  const attachFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setAttaching(true);
    try {
      for (const file of files) {
        if (isSupportedImage(file.type)) {
          if (file.size > MAX_IMAGE_BYTES) {
            toast(`"${file.name}": over 10 MB, skipped.`);
            continue;
          }
          try {
            const downscaled = await downscaleImage(file);
            setChips((prev) => [
              ...prev,
              {
                key: `img-${prev.length}-${Date.now()}`,
                kind: "image",
                name: file.name,
                excerpt: "",
                dataUrl: downscaled.dataUrl,
              },
            ]);
          } catch {
            toast(`"${file.name}": couldn't read as image.`);
          }
          continue;
        }
        if (!activeProject) {
          toast("Select a project first to attach files.");
          continue;
        }
        const mime = mimeForFile(file.name, file.type);
        if (!isSupportedMime(mime)) {
          toast(`"${file.name}": type not supported in v1 (text/code/images only).`);
          continue;
        }
        if (file.size > MAX_ATTACH_BYTES) {
          toast(`"${file.name}": over 1 MB, skipped.`);
          continue;
        }
        try {
          const text = await file.text();
          const bytes = new TextEncoder().encode(text);
          const result = await ingestDoc({
            projectId: activeProject.id,
            name: file.name,
            mime,
            bytes,
          });
          if (result.status === "unsupported") {
            toast(`"${file.name}": type not supported.`);
            continue;
          }
          if (result.status === "duplicate") {
            toast(`"${file.name}": already in project knowledge, attached anyway.`);
          }
          setChips((prev) => [
            ...prev,
            { key: result.id ?? `${file.name}-${prev.length}`, kind: "file", name: file.name, excerpt: text },
          ]);
        } catch {
          toast(`"${file.name}": couldn't attach.`);
        }
      }
    } finally {
      setAttaching(false);
    }
  };

  const removeChip = (key: string) =>
    setChips((prev) => prev.filter((chip) => chip.key !== key));

  const historyEntries = useMemo(() => {
    const users = messages
      .filter((m) => m.role === "user")
      .map((m) => m.content.trim())
      .filter((text) => text.length > 0)
      .reverse();
    return users.filter((text, i) => i === 0 || text !== users[i - 1]);
  }, [messages]);

  const canSend =
    !streaming &&
    !attaching &&
    !!activeConnection &&
    !!model &&
    (composerDraft.trim().length > 0 || chips.length > 0);

  const runExport = (args: string) => {
    const chat = conversations.find((item) => item.id === activeConversationId) ?? null;
    if (!chat || messages.length === 0) {
      toast("Nothing to export yet.");
      return;
    }
    const format = resolveExportFormat(args);
    if (!format) {
      toast("Usage: /export [md|json]");
      return;
    }
    if (format === "json") {
      downloadText(
        safeFilename(chat.title, "json"),
        JSON.stringify(buildChatExport(chat, messages), null, 2),
        "application/json",
      );
    } else {
      downloadText(safeFilename(chat.title, "md"), conversationToMarkdown(chat.title, messages));
    }
  };

  const runModel = (args: string) => {
    const result = resolveModelArg(args, models);
    if (result.kind === "picker") {
      if (modelButtonRef.current) openModelPicker(modelButtonRef.current);
      return;
    }
    if (result.kind === "set") {
      setModel(result.id);
      toast(`Model: ${result.id}`);
      return;
    }
    if (result.kind === "unknown") {
      toast(`No model matches "${args.trim()}".`);
      return;
    }
    toast(`Several models match: ${result.matches.join(", ")}`);
  };

  const slashHandlers = {
    new: () => void newConversation().catch(() => undefined),
    clear: () => void clearActiveConversation(),
    compact: () => void compactActive().catch(() => undefined),
    export: runExport,
    model: runModel,
    memory: () => setSettingsPage("memory"),
    settings: () => setSettingsPage("general"),
  };

  const submit = () => {
    const handle = editorRef.current;
    const text = (handle?.getMarkdown() ?? composerDraft).trim();
    const pending = chipsRef.current;
    if ((!text && pending.length === 0) || streaming || !activeConnection || !model) return;
    handle?.clear();
    setComposerDraft("");
    setSlashIndex(0);
    setChips([]);
    handle?.focus();
    const parsed = parseSlash(text);
    if (parsed) {
      const menuItem = mergedCommands.find((item) => item.name === parsed.name);
      if (menuItem?.shadowed) {
        toast(`Built-in /${parsed.name} shadows your file command.`);
      }
    }
    if (dispatchSlash(text, slashHandlers)) return;
    let sendText = text;
    if (parsed) {
      const file = fileCommands.find((command) => command.name === parsed.name);
      if (file) {
        const expanded = expandFileCommand(file, parsed.args);
        if (expanded.appended) toast("Args appended (template has no $ARGUMENTS).");
        sendText = expanded.text;
      }
    }
    const fileChips = pending.filter((chip) => chip.kind === "file");
    const imagePayloads = pending
      .filter((chip) => chip.kind === "image" && chip.dataUrl)
      .map((chip) => ({ dataUrl: chip.dataUrl as string }));
    const send = buildAttachmentSend(sendText, fileChips);
    const outgoing =
      send.outgoing.trim() || (imagePayloads.length > 0 ? "See the attached image." : "");
    void sendMessage(outgoing, send.block, imagePayloads).then((accepted) => {
      if (!accepted) {
        handle?.setMarkdown(text);
        setComposerDraft(text);
        setChips(pending);
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
    if (!dispatchSlash(`/${name}`, slashHandlers)) {
      if (fileCommands.some((file) => file.name === name)) {
        editorRef.current?.setMarkdown(`/${name} `);
        setComposerDraft(`/${name} `);
        editorRef.current?.focus();
      }
    }
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

  const modelLabel =
    activeConnection && model ? `${activeConnection.name} · ${model}` : "Select model";

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
      actionsRef.current.runSlash(items[clamped].name);
      return true;
    }
    if (event.key === "Escape") {
      setComposerDraft("");
      editorRef.current?.clear();
      return true;
    }
    return false;
  };

  return (
    <div
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        void attachFiles([...event.dataTransfer.files]);
      }}
      onPaste={(event) => {
        const files = [...event.clipboardData.files];
        if (files.length > 0) {
          event.preventDefault();
          void attachFiles(files);
        }
      }}
    >
      <div className="composer relative rounded-composer border border-border bg-surface-2 px-2.5 pb-2 pt-2 focus-within:border-accent/70">
        <SlashMenu
          items={slashItems}
          index={Math.min(slashIndex, Math.max(0, slashItems.length - 1))}
          onPick={runSlash}
        />
        {chips.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <span
                key={chip.key}
                className="flex max-w-[220px] items-center gap-1 rounded-control border border-border bg-surface px-2 py-0.5 text-xs"
                title={chip.name}
              >
                <span className="truncate">{chip.name}</span>
                <button
                  type="button"
                  onClick={() => removeChip(chip.key)}
                  aria-label={`Remove ${chip.name}`}
                  className="flex-none text-muted hover:text-fg"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
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
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              void attachFiles([...(event.target.files ?? [])]);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Attach files"
            title="Attach text files (project knowledge)"
            disabled={attaching || streaming}
            className="grid h-7 w-7 flex-none place-items-center rounded-control border border-border bg-surface text-muted hover:bg-hover disabled:text-faint"
          >
            <Paperclip size={14} />
          </button>
          <button
            type="button"
            ref={modelButtonRef}
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
          <Select
            size="sm"
            className="w-28 flex-none"
            value={reasoningEffort ?? "none"}
            onChange={(level) => setReasoningEffort(level === "none" ? null : level)}
            aria-label="Reasoning effort"
            title={
              supportedEfforts
                ? "Reasoning effort for this model"
                : "This model does not advertise reasoning levels"
            }
            disabled={!supportedEfforts}
            options={(supportedEfforts ?? ["none"]).map((level) => ({
              value: level,
              label: level === "none" ? "No reasoning" : level,
            }))}
          />
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
      <ModelPickerHost />
    </div>
  );
}
