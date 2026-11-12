import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, ChevronDown, Mic, Paperclip, Square, X } from "lucide-react";
import { useApp } from "../lib/store";
import { ModelPickerHost, openModelPicker } from "./ModelPicker";
import { ProviderIcon } from "./ProviderIcon";
import { Select } from "./ui/select";
import { ContextRing } from "./ContextRing";
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
import { QueuePanel } from "./composer/QueuePanel";
import {
  enqueueMessage,
  moveQueuedMessage,
  moveQueuedMessageToFront,
  queuedFor,
  removeQueuedMessage,
  type QueuedMessage,
} from "./composer/queue";
import { SkillMenu } from "./SkillMenu";
import { skillsList, type SkillInfo } from "../lib/api";
import { matchSkills, parseSkillCommand, skillMention } from "../lib/skills";
import {
  MAX_DOCS_PER_TURN,
  releaseChatDoc,
  releaseChatDocs,
} from "../lib/chat-docs";
import { clipboardFiles } from "../lib/clipboard";
import { useVoiceInput } from "./composer/useVoiceInput";
import type { FileCommand } from "../lib/types";
import {
  collectChips,
  docChipsIn,
  docsOf,
  imagesOf,
  isDocChip,
  isDocFile,
  outgoingText,
  type AttachChip,
} from "./composer/attachments";

type ParsedSlash = { name: string; args: string };

function warnIfShadowed(parsed: ParsedSlash | null, commands: SlashCommand[]): void {
  if (!parsed) return;
  if (commands.find((item) => item.name === parsed.name)?.shadowed) {
    toast(`Built-in /${parsed.name} shadows your file command.`);
  }
}

function expandCommandText(
  text: string,
  parsed: ParsedSlash | null,
  commands: FileCommand[],
): string {
  if (!parsed) return text;
  const file = commands.find((command) => command.name === parsed.name);
  if (!file) return text;
  const expanded = expandFileCommand(file, parsed.args);
  if (expanded.appended) toast("Args appended (template has no $ARGUMENTS).");
  return expanded.text;
}

function readyToSend(streaming: boolean, connected: boolean, model: string): boolean {
  if (streaming) return false;
  if (!connected) return false;
  return model.length > 0;
}

function hasContent(text: string, chips: number): boolean {
  return text.length > 0 || chips > 0;
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
    <div className="absolute bottom-full left-2 z-10 mb-2 min-w-[260px] rounded-card bg-overlay p-1 shadow-[var(--shadow-md)] ring-1 ring-line">
      {items.map((command, i) => (
        <button
          key={command.name}
          type="button"
          onClick={() => onPick(command.name)}
          className={cn(
            "flex w-full items-center gap-2 rounded-field px-2.5 py-1.5 text-left text-sm",
            i === index ? "bg-fill-2" : "hover:bg-fill-2",
          )}
        >
          <b className="font-mono text-[13px] text-fg">
            /{command.name}
            {command.hint ? ` ${command.hint}` : ""}
          </b>
          <span className="text-fg-3">{command.label}</span>
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
    models,
    setModel,
    messages,
    conversations,
    activeConversationId,
    workingConversationId,
    clearActiveConversation,
    setSettingsPage,
    newConversation,
    compactActive,
    uncompactActive,
    contextInfo,
    showContextBar,
    openContextPanel,
    reasoningEffort,
    setReasoningEffort,
    supportedEfforts,
    fileCommands,
    loadFileCommands,
    setVoicePhase,
  } = useApp();
  const effortValue =
    reasoningEffort && supportedEfforts?.includes(reasoningEffort)
      ? reasoningEffort
      : supportedEfforts?.includes("high")
        ? "high"
        : (supportedEfforts?.[0] ?? "none");
  const editorRef = useRef<TipTapHandle | null>(null);
  const modelButtonRef = useRef<HTMLButtonElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [skillIndex, setSkillIndex] = useState(0);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [chips, setChips] = useState<AttachChip[]>([]);
  const [queue, setQueue] = useState<QueuedMessage<AttachChip>[]>([]);
  const [queueBlocked, setQueueBlocked] = useState(false);
  const [queueCollapsed, setQueueCollapsed] = useState(
    () => localStorage.getItem("queueCollapsed") === "1",
  );
  const queueRef = useRef(queue);
  queueRef.current = queue;
  const wasStreamingRef = useRef(streaming);
  const lastChatRef = useRef(activeConversationId);
  const drainingRef = useRef(false);
  const [attaching, setAttaching] = useState(false);
  const chipsRef = useRef(chips);
  chipsRef.current = chips;

  const concreteDraft = (editorRef.current?.getMarkdown() ?? composerDraft).trim();
  const mergedCommands = useMemo(() => mergeSlashCommands(fileCommands), [fileCommands]);
  const skillQuery = parseSkillCommand(concreteDraft);
  const skillItems = skillQuery === null ? [] : matchSkills(skills, skillQuery);
  const slashItems =
    skillQuery === null && /^\/[\w-]*$/.test(concreteDraft)
      ? matchSlash(concreteDraft, mergedCommands)
      : [];

  const refreshSkills = useCallback(async () => {
    try {
      setSkills(await skillsList());
    } catch (error) {
      console.warn("skills list failed", error);
    }
  }, []);

  useEffect(() => {
    const onFocus = () => {
      void loadFileCommands();
      void refreshSkills();
    };
    window.addEventListener("focus", onFocus);
    void loadFileCommands();
    void refreshSkills();
    return () => window.removeEventListener("focus", onFocus);
  }, [loadFileCommands, refreshSkills]);

  const menuOpenRef = useRef(false);
  const menuOpen = slashItems.length > 0 || skillQuery !== null;
  useEffect(() => {
    if (menuOpen && !menuOpenRef.current) {
      void loadFileCommands();
      void refreshSkills();
    }
    menuOpenRef.current = menuOpen;
  }, [menuOpen, loadFileCommands, refreshSkills]);

  const attachFiles = async (files: File[]) => {
    if (files.length === 0) return;
    setAttaching(true);
    try {
      const room = MAX_DOCS_PER_TURN - docChipsIn(chipsRef.current);
      const added = await collectChips(files, activeConversationId, room);
      setChips((prev) => [...prev, ...added]);
      if (files.filter(isDocFile).length > room) {
        toast(`Up to ${MAX_DOCS_PER_TURN} documents per message.`);
      }
    } finally {
      setAttaching(false);
    }
  };

  const removeChip = (key: string) => {
    const chip = chipsRef.current.find((item) => item.key === key);
    const rest = chipsRef.current.filter((item) => item.key !== key);
    setChips(rest);
    if (chip && isDocChip(chip)) void releaseChatDoc(chip.doc, docsOf(rest));
  };

  const visibleQueue = activeConversationId ? queuedFor(queue, activeConversationId) : [];

  const releaseQueuedChips = (chipsToDrop: AttachChip[], remaining: QueuedMessage<AttachChip>[]) => {
    const keep = [...chipsRef.current, ...remaining.flatMap((item) => item.attachments)]
      .filter(isDocChip)
      .map((chip) => chip.doc);
    for (const chip of chipsToDrop) {
      if (isDocChip(chip)) void releaseChatDoc(chip.doc, keep);
    }
  };

  const queueMessage = (text: string, attachments: AttachChip[]): boolean => {
    if (!activeConversationId) return false;
    const item: QueuedMessage<AttachChip> = {
      id: `queue-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      conversationId: activeConversationId,
      text,
      attachments,
    };
    setQueue((prev) => enqueueMessage(prev, item));
    setQueueBlocked(false);
    editorRef.current?.clear();
    setComposerDraft("");
    setSlashIndex(0);
    setSkillIndex(0);
    setChips([]);
    editorRef.current?.focus();
    return true;
  };

  const editQueued = (id: string) => {
    const item = queueRef.current.find((entry) => entry.id === id);
    if (!item) return;
    setQueue((prev) => removeQueuedMessage(prev, id));
    setQueueBlocked(false);
    editorRef.current?.setMarkdown(item.text);
    setComposerDraft(item.text);
    setChips(item.attachments);
    editorRef.current?.focus();
  };

  const removeQueued = (id: string) => {
    const item = queueRef.current.find((entry) => entry.id === id);
    if (!item) return;
    const rest = removeQueuedMessage(queueRef.current, id);
    setQueue(rest);
    setQueueBlocked(false);
    releaseQueuedChips(item.attachments, rest);
  };

  const moveQueued = (id: string, index: number) => {
    setQueue((prev) => moveQueuedMessage(prev, id, index));
  };

  const sendQueued = (id: string) => {
    const item = queueRef.current.find((entry) => entry.id === id);
    if (!item) return;
    setQueueBlocked(false);
    if (streaming) {
      setQueue((prev) => moveQueuedMessageToFront(prev, id));
      toast("Next after this reply.");
      return;
    }
    setQueue(removeQueuedMessage(queueRef.current, id));
    void sendMessage(item.text, imagesOf(item.attachments), docsOf(item.attachments)).then(
      (accepted) => {
        if (!accepted) {
          setQueue((prev) => [item, ...prev]);
          setQueueBlocked(true);
        }
      },
    );
  };

  const toggleQueue = () => {
    setQueueCollapsed((prev) => {
      const next = !prev;
      localStorage.setItem("queueCollapsed", next ? "1" : "0");
      return next;
    });
  };

  useEffect(() => {
    const chatChanged = lastChatRef.current !== activeConversationId;
    lastChatRef.current = activeConversationId;
    const finished = wasStreamingRef.current && !streaming;
    wasStreamingRef.current = streaming;
    if (!finished && !chatChanged) return;
    if (streaming || queueBlocked || drainingRef.current) return;
    if (!activeConversationId || !activeConnection || !model) return;
    const next = queuedFor(queueRef.current, activeConversationId)[0];
    if (!next) return;
    drainingRef.current = true;
    setQueue((prev) => removeQueuedMessage(prev, next.id));
    void sendMessage(next.text, imagesOf(next.attachments), docsOf(next.attachments))
      .then((accepted) => {
        if (!accepted) {
          setQueue((prev) => [next, ...prev]);
          setQueueBlocked(true);
        }
      })
      .finally(() => {
        drainingRef.current = false;
      });
  }, [streaming, activeConversationId, activeConnection, model, queueBlocked, sendMessage]);

  const voice = useVoiceInput((text) => editorRef.current?.appendMarkdown(text), streaming);

  useEffect(() => {
    const phase = voice.recording
      ? "recording"
      : voice.starting
        ? "starting"
        : voice.transcribing
          ? "transcribing"
          : "idle";
    setVoicePhase(phase);
    return () => setVoicePhase("idle");
  }, [voice.recording, voice.starting, voice.transcribing, setVoicePhase]);

  const historyEntries = useMemo(() => {
    const users = messages
      .filter((m) => m.role === "user")
      .map((m) => m.content.trim())
      .filter((text) => text.length > 0)
      .reverse();
    return users.filter((text, i) => i === 0 || text !== users[i - 1]);
  }, [messages]);

  const canSend =
    !attaching &&
    !!activeConnection &&
    !!model &&
    (composerDraft.trim().length > 0 || chips.length > 0) &&
    (!streaming || !!activeConversationId);

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
    visualize: (args: string) => {
      const prompt = args.trim();
      if (!prompt) {
        editorRef.current?.setMarkdown("@visualize ");
        setComposerDraft("@visualize ");
        editorRef.current?.focus();
        return;
      }
      void sendMessage(`@visualize ${prompt}`).then((accepted) => {
        if (!accepted) toast("Couldn't send that request.");
      });
    },
    memory: () => setSettingsPage("memory"),
    settings: () => setSettingsPage("general"),
  };

  const pickSkill = (skill: SkillInfo) => {
    const text = skillMention(skill.name);
    editorRef.current?.setMarkdown(text);
    setComposerDraft(text);
    setSkillIndex(0);
    editorRef.current?.focus();
  };
  const pickSkillRef = useRef(pickSkill);
  pickSkillRef.current = pickSkill;

  const submit = () => {
    const handle = editorRef.current;
    const text = (handle?.getMarkdown() ?? composerDraft).trim();
    const pending = chipsRef.current;
    if (!hasContent(text, pending.length)) return;
    const pendingSkill = parseSkillCommand(text);
    if (pendingSkill !== null) {
      const matches = matchSkills(skills, pendingSkill);
      if (matches.length === 1) {
        pickSkill(matches[0]);
        return;
      }
      if (matches.length === 0) {
        toast(
          skills.length === 0
            ? "No skills installed. Add one in Settings → Skills."
            : `No skill matches "${pendingSkill}".`,
        );
        return;
      }
      toast(`Pick a skill from the menu (${matches.length} match).`);
      return;
    }
    if (streaming) {
      if (!activeConnection || !model || !activeConversationId) return;
      if (parseSlash(text)) {
        toast("Commands wait until the current reply finishes.");
        return;
      }
      const images = imagesOf(pending);
      const docs = docsOf(pending);
      queueMessage(outgoingText(text, images.length, docs.length), pending);
      return;
    }
    if (!readyToSend(streaming, activeConnection !== null, model)) return;
    handle?.clear();
    setComposerDraft("");
    setSlashIndex(0);
    setChips([]);
    handle?.focus();
    const parsed = parseSlash(text);
    warnIfShadowed(parsed, mergedCommands);
    if (dispatchSlash(text, slashHandlers)) {
      void releaseChatDocs(docsOf(pending));
      return;
    }
    const docs = docsOf(pending);
    const images = imagesOf(pending);
    const sendText = expandCommandText(text, parsed, fileCommands);
    const outgoing = outgoingText(sendText, images.length, docs.length);
    void sendMessage(outgoing, images, docs).then((accepted) => {
      if (!accepted) {
        handle?.setMarkdown(text);
        setComposerDraft(text);
        setChips(pending);
        if (
          workingConversationId === null ||
          workingConversationId === activeConversationId
        ) {
          toast("Couldn't send that message.");
        }
      }
    });
  };

  const submitRef = useRef(submit);
  submitRef.current = submit;
  const stateRef = useRef({ streaming, sendWith, slashItems, skillItems, skillQuery, historyEntries });
  stateRef.current = { streaming, sendWith, slashItems, skillItems, skillQuery, historyEntries };
  const actionsRef = useRef({
    stopStream,
    runSlash: (_name: string) => {},
  });
  actionsRef.current.stopStream = stopStream;

  const runSlash = (name: string) => {
    if (name === "skill") {
      editorRef.current?.setMarkdown("/skill");
      setComposerDraft("/skill");
      setSlashIndex(0);
      setSkillIndex(0);
      editorRef.current?.focus();
      return;
    }
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
      isPopupOpen: () =>
        stateRef.current.slashItems.length > 0 || stateRef.current.skillQuery !== null,
      sendOnEnter: () => stateRef.current.sendWith === "enter",
      historyEntries: () => stateRef.current.historyEntries,
    }),
    [],
  );

  const modelLabel =
    activeConnection && model ? `${activeConnection.name} · ${model}` : "Select model";
  const conversation = conversations.find((item) => item.id === activeConversationId) ?? null;
  const contextPct = contextInfo.pct;
  const canCompact = messages.length > 4 && !streaming;

  const slashIndexRef = useRef(slashIndex);
  slashIndexRef.current = slashIndex;
  const skillIndexRef = useRef(skillIndex);
  skillIndexRef.current = skillIndex;
  const keyDownRef = useRef((_event: KeyboardEvent): boolean => false);
  keyDownRef.current = (event) => {
    if (stateRef.current.skillQuery !== null) {
      const items = stateRef.current.skillItems;
      if (items.length > 0 && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
        event.preventDefault();
        setSkillIndex((i) =>
          event.key === "ArrowDown" ? (i + 1) % items.length : (i - 1 + items.length) % items.length,
        );
        return true;
      }
      if (items.length > 0 && event.key === "Enter") {
        event.preventDefault();
        const clamped = Math.min(skillIndexRef.current, Math.max(0, items.length - 1));
        pickSkillRef.current(items[clamped]);
        return true;
      }
      if (event.key === "Escape") {
        setComposerDraft("");
        editorRef.current?.clear();
        return true;
      }
      return false;
    }
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
      onPasteCapture={(event) => {
        const data = event.clipboardData;
        let hasFile = data.files.length > 0;
        for (let index = 0; !hasFile && index < data.items.length; index += 1) {
          hasFile = data.items[index].kind === "file";
        }
        if (!hasFile) return;
        event.preventDefault();
        event.stopPropagation();
        void clipboardFiles(data)
          .then((files) => {
            if (files.length > 0) void attachFiles(files);
          })
          .catch(() => toast("Couldn't read the pasted image."));
      }}
    >
      <div className="composer relative rounded-composer bg-raised px-2 pb-2 pt-2 shadow-[inset_0_0_0_1px_var(--line),var(--shadow-sm)]">
        <QueuePanel
          items={visibleQueue.map((item) => ({ id: item.id, text: item.text }))}
          collapsed={queueCollapsed}
          onToggle={toggleQueue}
          onEdit={editQueued}
          onSend={sendQueued}
          onRemove={removeQueued}
          onMove={moveQueued}
        />
        {skillQuery !== null ? (
          <SkillMenu
            items={skillItems}
            index={Math.min(skillIndex, Math.max(0, skillItems.length - 1))}
            onPick={pickSkill}
          />
        ) : (
          <SlashMenu
            items={slashItems}
            index={Math.min(slashIndex, Math.max(0, slashItems.length - 1))}
            onPick={runSlash}
          />
        )}
        {chips.length > 0 && (
          <div className="mb-1.5 flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <span
                key={chip.key}
                className="flex max-w-[220px] items-center gap-1 rounded-chip bg-fill-2 px-2 py-0.5 text-xs text-fg-2"
                title={chip.name}
              >
                <span className="truncate">{chip.name}</span>
                {chip.detail && (
                  <span className="flex-none text-fg-3">{chip.detail}</span>
                )}
                <button
                  type="button"
                  onClick={() => removeChip(chip.key)}
                  aria-label={`Remove ${chip.name}`}
                  className="flex-none text-fg-3 hover:text-fg"
                >
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <TipTapEditor
          placeholder="Message MyAgent"
          autoFocus={autoFocus}
          signal={composerSignal}
          handleRef={editorRef}
          onChangeMarkdown={(markdown) => {
            setComposerDraft(markdown);
            setSlashIndex(0);
            setSkillIndex(0);
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
            title="Attach documents (pdf, docx, xlsx, md, txt…) or images"
            disabled={attaching || streaming}
            className="grid h-7 w-7 flex-none place-items-center rounded-field text-fg-2 hover:bg-fill-2 hover:text-fg disabled:text-text-off"
          >
            <Paperclip size={16} />
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
            className="flex h-7 max-w-[260px] items-center gap-1.5 truncate rounded-field px-2 text-[13px] text-fg-2 hover:bg-fill-2 hover:text-fg"
          >
            {activeConnection && (
              <ProviderIcon kind={activeConnection.kind} size={16} className="flex-none" />
            )}
            <span className="truncate">{modelLabel}</span>
            <ChevronDown size={14} className="flex-none text-fg-3" />
          </button>
          <Select
            size="sm"
            className="w-auto min-w-0 shrink border-transparent bg-transparent shadow-none hover:border-transparent hover:bg-fill-2"
            value={effortValue}
            onChange={(level) => setReasoningEffort(level)}
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
          {showContextBar && (
            <button
              type="button"
              onClick={openContextPanel}
              title={`Context · ${contextPct ?? 0}% used`}
              aria-label={`Open context inspector · ${contextPct ?? 0}% used`}
              className="flex h-7 items-center gap-1.5 rounded-field px-2 text-xs text-fg-3 hover:bg-fill-2 hover:text-fg-2"
            >
              <ContextRing
                pct={contextPct}
                size={14}
                warn={contextPct !== null && contextPct >= 80}
              />
              {contextPct === null ? "Context" : `${contextPct}%`}
            </button>
          )}
          <button
            type="button"
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              event.preventDefault();
              event.currentTarget.setPointerCapture(event.pointerId);
              void voice.start();
            }}
            onPointerUp={() => void voice.stop()}
            onPointerCancel={voice.cancel}
            onLostPointerCapture={voice.cancel}
            onKeyDown={(event) => {
              if (event.repeat) return;
              if (event.key === " " || event.key === "Enter") {
                event.preventDefault();
                void voice.start();
              }
            }}
            onKeyUp={(event) => {
              if (event.key === " " || event.key === "Enter") {
                event.preventDefault();
                void voice.stop();
              }
            }}
            disabled={streaming || voice.transcribing}
            aria-label={
              voice.recording
                ? "Stop recording"
                : voice.starting
                  ? "Starting microphone"
                  : "Hold to talk"
            }
            title={
              voice.recording
                ? "Release to transcribe"
                : voice.starting
                  ? "Starting microphone…"
                  : "Hold to talk"
            }
            className={cn(
              "grid h-7 w-7 flex-none place-items-center rounded-field",
              voice.recording
                ? "bg-danger text-on-danger"
                : voice.starting
                  ? "bg-fill-3 text-fg-2"
                  : "text-fg-2 hover:bg-fill-2 hover:text-fg",
              "disabled:text-text-off",
            )}
          >
            <Mic size={16} />
          </button>
          {streaming ? (
            <button
              type="button"
              onClick={stopStream}
              aria-label="Stop (Esc)"
              title="Stop (Esc)"
              className="ml-1 grid h-8 w-8 flex-none place-items-center rounded-[10px] bg-accent text-accent-contrast"
            >
              <Square size={14} fill="currentColor" />
            </button>
          ) : (
            <button
              type="button"
              onClick={() => submitRef.current()}
              aria-label="Send"
              disabled={!canSend}
              className="ml-1 grid h-8 w-8 flex-none place-items-center rounded-[10px] bg-accent text-accent-contrast disabled:bg-fill-2 disabled:text-text-off"
            >
              <ArrowUp size={16} />
            </button>
          )}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-fg-3">
        {workingConversationId && workingConversationId !== activeConversationId ? (
          <span>Another chat is working — open it to stop it before sending here.</span>
        ) : (
          <>
            <span>Markdown supported</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">/</span>
            <span>for commands</span>
            <span aria-hidden="true">·</span>
            <span>keys stay in Windows Credential Manager</span>
            {conversation?.compacted === 1 && (
              <button
                type="button"
                onClick={() => void uncompactActive()}
                className="text-accent-text underline underline-offset-2 hover:text-fg"
              >
                Show all messages
              </button>
            )}
            {canCompact && (
              <button
                type="button"
                onClick={() => void compactActive()}
                className="text-fg-3 underline underline-offset-2 hover:text-fg-2"
              >
                Compact
              </button>
            )}
          </>
        )}
      </div>
      <ModelPickerHost />
    </div>
  );
}
