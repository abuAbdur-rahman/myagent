import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import * as db from "./db";
import * as api from "./api";
import { applyCompactWindow, applySummaryWindow, buildChildSystemPrompt, buildSystemPrompt, DEFAULT_MODEL_CONTEXT, estimateContext, promptBudget, summarySystemTurn } from "./context";
import { OPENUI_SYSTEM_PROMPT } from "./openui/prompt";
import { readVisualTheme, visualThemePrompt } from "./theme-prompt";
import { buildUserContent, resolveImageSend, searchKnowledgeWithHits, withFinalTurnImages } from "./knowledge";
import { buildEpisodeBlock, selectEpisodeHits } from "./episodes";
import {
  buildDocumentBlock,
  commitChatDocs,
  copyChatDocs,
  prependDocumentBlock,
  toAttachment,
  withDocumentBlock,
  type ChatDocument,
} from "./chat-docs";
import { buildSkillIndexBlock, resolveSkillMentions } from "./skills";
import { notifyTurnDone } from "./notify";
import { logEvent } from "./debug";
import {
  artifactVersions,
  type ArtifactLocator,
  type ArtifactVersion,
} from "./artifact-versions";
import { parseExtractedNotes } from "./memory-extract";
import {
  hasUntrustedProvenance,
  projectScopedNotes,
  rollupReason,
  rollupTranscript,
  uniqueRollupNotes,
  type RollupReason,
} from "./memory-rollup";
import {
  deepestLeaf,
  messagePath,
  siblingVersions,
  versionMap,
  type VersionInfo,
} from "./message-tree";
import { fitImageBudget } from "./image";
import {
  lookupContextLength,
  lookupEfforts,
  lookupSupportsTools,
  modelCanSeeImages,
  type ModelCapabilities,
  type VisionOverride,
} from "./catalog";
import { toast } from "./toast";
import type { VoicePhase } from "./activity";
import {
  clampFontScale,
  parseDensity,
  parseFontScale,
  parseGroupByDate,
  type Density,
} from "./appearance";
import { accentIdOf, parseAccent } from "./accent";
import {
  readVisionFallback,
  readVisionOverrides,
  visionOverrideFor,
  withVisionOverride,
  writeVisionFallback,
  writeVisionOverride,
  type ConnectionModelOption,
  type VisionFallback,
} from "./vision";
import { KEYLESS_KINDS, fileCommandSchema, memoryInputSchema } from "./types";
import { errorText, newId } from "./utils";
import { deriveFallbackTitle, plainTitle } from "./title";
import { useThemeName } from "./useThemeName";
import type {
  Connection,
  ConnectionInput,
  Conversation,
  DeclaredArtifact,
  Memory,
  MemoryDraft,
  MemoryInput,
  MemoryKind,
  MemoryScope,
  PendingMemory,
  Project,
  ProjectInput,
  Message,
  Todo,
  ToolLogEntry,
  FileCommand,
  ScreenVerdict,
  StreamEvent,
} from "./types";

const ACTIVE_CONNECTION_KEY = "activeConnectionId";
const ACTIVE_PROJECT_KEY = "activeProjectId";
const MODEL_KEY = "model";
const SIDEBAR_KEY = "sidebarCollapsed";
const THEME_KEY = "theme";
const DISPLAY_NAME_KEY = "displayName";
const PANEL_WIDTH_KEY = "panelWidth";
const SHOW_CONTEXT_BAR_KEY = "showContextBar";

const MEMORY_KIND_NAMES = ["fact", "preference", "summary", "note"];

function memoryFromEntry(
  entry: api.MemoryEntryView,
  scope: MemoryScope,
  projectId: string | null,
): Memory {
  return {
    id: entry.id,
    scope,
    project_id: projectId,
    kind: MEMORY_KIND_NAMES.includes(entry.kind) ? (entry.kind as MemoryKind) : "note",
    content: entry.text,
    untrusted: entry.untrusted,
    created_at: entry.created_at,
    updated_at: entry.created_at,
  };
}

function canonicalMemoryId(id: string): string {
  return id.replace(/-/g, "").toLowerCase();
}

function sentMemories(memories: Memory[], ids: readonly string[] | null): Memory[] {
  if (ids === null) return memories;
  const byId = new Map(memories.map((memory) => [memory.id, memory]));
  return ids.flatMap((id) => {
    const memory = byId.get(id);
    return memory ? [memory] : [];
  });
}

export function orderedSentMemories(
  global: Memory[],
  project: Memory[],
  ids: readonly string[] | null,
): Memory[] {
  const memories = [...global, ...project];
  return sentMemories(memories, ids);
}

function rollupTrustKey(conversationId: string): string {
  return `memoryRollupUntrusted:${conversationId}`;
}

function markRollupUntrusted(conversationId: string): void {
  localStorage.setItem(rollupTrustKey(conversationId), "1");
}

function wasRollupUntrusted(conversationId: string): boolean {
  return localStorage.getItem(rollupTrustKey(conversationId)) === "1";
}

function canSeeFor(
  catalog: ModelCapabilities[] | null,
  overrides: Record<string, VisionOverride>,
  activeConnectionId: string | null,
  connectionId: string | null,
  modelId: string,
): boolean {
  const scoped = connectionId !== null && connectionId === activeConnectionId ? catalog : null;
  return modelCanSeeImages(scoped, modelId, visionOverrideFor(overrides, connectionId, modelId));
}

function knownVisionFallback(
  fallback: VisionFallback | null,
  connections: Connection[],
): VisionFallback | null {
  if (!fallback) return null;
  if (fallback.connectionId && !connections.some((row) => row.id === fallback.connectionId)) {
    return null;
  }
  return fallback;
}

function visionFallbackFor(
  hasImages: boolean,
  fallback: VisionFallback | null,
  toolsOn: boolean,
  seesImages: boolean,
  activeConnectionId: string,
  connections: Connection[],
): VisionFallback | null {
  const known = knownVisionFallback(fallback, connections);
  if (!hasImages || !known || !toolsOn || seesImages) return null;
  return { connectionId: known.connectionId || activeConnectionId, model: known.model };
}

function fallbackFields(fallback: VisionFallback | null): {
  visionFallbackModel: string | null;
  visionFallbackConnection: string | null;
} {
  return {
    visionFallbackModel: fallback?.model ?? null,
    visionFallbackConnection: fallback?.connectionId ?? null,
  };
}

function imageDropToast(hasFallback: boolean): string {
  return hasFallback
    ? "This model can't read images and tools are off — sending text only."
    : "This model can't read images and no vision fallback is set — sending text only.";
}

async function collectModelOptions(
  connections: Connection[],
  report: (cause: unknown) => void,
): Promise<ConnectionModelOption[]> {
  const options: ConnectionModelOption[] = [];
  for (const connection of connections) {
    try {
      if (!KEYLESS_KINDS.has(connection.kind) && !(await api.hasApiKey(connection.id))) continue;
      const [list, caps, hidden] = await Promise.all([
        api.listModels(connection.id, connection.kind),
        api.listModelCaps(connection.id, connection.kind),
        db.listHiddenModels(connection.id),
      ]);
      const hiddenSet = new Set(hidden);
      for (const id of list) {
        if (hiddenSet.has(id)) continue;
        options.push({
          connectionId: connection.id,
          connectionName: connection.name,
          modelId: id,
          seesImages: modelCanSeeImages(caps, id),
        });
      }
    } catch (cause) {
      report(cause);
    }
  }
  return options;
}

function clampPanelWidth(width: number): number {
  return Math.min(640, Math.max(360, Math.round(width)));
}

export type ThemeMode = "system" | "light" | "dark";

type ToolEntry = ToolLogEntry;

type PayloadTurn = {
  role: string;
  content: string | api.ChatContentPart[];
  reasoning?: string | null;
};

const MEMORY_WRITE_TOOLS: ReadonlySet<string> = new Set([
  "remember",
  "update_memory",
  "delete_memory",
]);

export function settleToolLog(entries: ToolEntry[]): ToolEntry[] {
  return entries.map((entry) =>
    entry.status === "running"
      ? {
          ...entry,
          status: "err" as const,
          preview: entry.preview ? `Interrupted · ${entry.preview}` : "Interrupted",
        }
      : entry,
  );
}

export function toolLogPatch(entries: ToolEntry[]): { tool_log: string | null } {
  return { tool_log: entries.length > 0 ? JSON.stringify(entries) : null };
}

export function seedToolLog(entries: ToolEntry[], seedId: string): ToolEntry[] {
  return entries.map((entry, index) => ({ ...entry, id: `${seedId}#${index}` }));
}

const SUBAGENT_PREVIEW_LIMIT = 2000;

function subagentPreview(current: string | null, event: StreamEvent): string | null {
  const base = current ?? "";
  const line = base.length > 0 && !base.endsWith("\n") ? "\n" : "";
  let next: string;
  switch (event.type) {
    case "delta":
      next = base + event.text;
      break;
    case "tool_start":
      next = `${base}${line}-> ${event.name}: ${event.summary}`;
      break;
    case "tool_result":
      next = `${base}${line}${event.ok ? "ok" : "fail"}: ${event.preview}`;
      break;
    case "retrying":
      next = `${base}${line}retrying (${event.attempt}/${event.max})`;
      break;
    default:
      return current;
  }
  return next.length > SUBAGENT_PREVIEW_LIMIT
    ? `${next.slice(0, SUBAGENT_PREVIEW_LIMIT)}...`
    : next;
}

type View = "chat" | "projects" | "project" | "outputs";

export type PanelTab = "preview" | "code" | "doc" | "source";
export type PanelMode = "dock" | "full" | "mini";
type PanelView = "session" | "artifact" | "context";

interface PanelArtifact {
  id: string;
  title: string;
  lang: string;
  code: string;
  path?: string;
  messageId?: string;
  locator?: ArtifactLocator;
}

function defaultPanelTab(lang: string): PanelTab {
  const normalized = lang.toLowerCase();
  if (
    normalized === "html" ||
    normalized === "htm" ||
    normalized === "pdf" ||
    normalized === "docx" ||
    normalized === "pptx" ||
    normalized === "xlsx" ||
    normalized === "odt" ||
    normalized === "ods" ||
    normalized === "odp"
  ) {
    return "preview";
  }
  if (normalized === "md" || normalized === "markdown") return "doc";
  return "code";
}

function parseFileCommands(raw: unknown): { rows: FileCommand[]; invalid: number } {
  const list = Array.isArray(raw) ? raw : [];
  const rows: FileCommand[] = [];
  let invalid = 0;
  for (const item of list) {
    const parsed = fileCommandSchema.safeParse(item);
    if (parsed.success) rows.push(parsed.data);
    else invalid += 1;
  }
  return { rows, invalid };
}

interface AppContextValue {
  ready: boolean;
  error: string | null;
  clearError: () => void;
  canRetry: boolean;
  retryTurn: () => Promise<void>;
  approval: {
    id: string;
    tool: string;
    command: string;
    cwd: string;
    screen: ScreenVerdict | null;
    screenFailed: boolean;
  } | null;
  replyApproval: (reply: "once" | "always" | "deny") => Promise<void>;
  question: { id: string; question: string; options: string[]; allowCustom: boolean } | null;
  answerQuestion: (answer: string) => Promise<void>;

  connections: Connection[];
  activeConnection: Connection | null;
  activeConnectionId: string | null;
  selectConnection: (id: string | null) => void;
  refreshConnections: (options?: { selectFirst?: boolean }) => Promise<void>;
  saveConnection: (
    input: ConnectionInput,
    id?: string,
    options?: { activate?: boolean },
  ) => Promise<Connection>;
  removeConnection: (id: string) => Promise<void>;

  models: string[];
  loadingModels: boolean;
  refreshModels: (force?: boolean) => Promise<void>;
  hiddenModels: string[];
  catalog: ModelCapabilities[] | null;
  toggleModelVisibility: (connectionId: string, modelId: string, hidden: boolean) => Promise<void>;
  setAllModelsVisibility: (
    connectionId: string,
    modelIds: string[],
    hidden: boolean,
  ) => Promise<void>;
  model: string;
  setModel: (model: string) => void;
  visionFallback: VisionFallback | null;
  setVisionFallback: (value: VisionFallback | null) => void;
  modelVisionOverride: (connectionId: string | null, modelId: string) => VisionOverride;
  setModelVisionOverride: (
    connectionId: string | null,
    modelId: string,
    value: VisionOverride,
  ) => void;
  canSeeImages: (connectionId: string | null, modelId: string) => boolean;
  loadAllModelOptions: () => Promise<ConnectionModelOption[]>;
  reasoningEffort: string | null;
  setReasoningEffort: (effort: string | null) => void;
  supportedEfforts: string[] | null;
  modelContextLimit: number | null;
  contextInfo: {
    tokens: number;
    limit: number;
    pct: number | null;
    real: boolean;
    limitKnown: boolean;
    lastIn: number | null;
    lastOut: number | null;
    prompt: string;
  };
  inspectContext: () => Promise<api.RequestInspection>;

  projects: Project[];
  activeProject: Project | null;
  activeProjectId: string | null;
  selectProject: (id: string | null) => void;
  view: View;
  setView: (view: View) => void;
  startProjectChat: (
    projectId: string,
    text: string,
    images?: { dataUrl: string }[],
    docs?: ChatDocument[],
  ) => Promise<boolean>;
  saveProject: (input: ProjectInput, id?: string) => Promise<Project>;
  removeProject: (id: string) => Promise<void>;
  refreshProjects: () => Promise<void>;

  globalMemories: Memory[];
  projectMemories: Memory[];
  globalSentMemories: Memory[];
  projectSentMemories: Memory[];
  recalledMemories: Memory[];
  recalledDetails: { id: string; score: number }[];
  knowledgeSummary: api.KnowledgeHit[];
  episodeSummary: api.EpisodeHit[];
  pendingMemories: PendingMemory[];
  memoryOmitted: number;
  memoryPaused: boolean;
  setMemoryPaused: (value: boolean) => void;
  episodicRecall: boolean;
  setEpisodicRecall: (value: boolean) => void;
  memoryCompat: boolean;
  memoryReport: api.MemoryMigrationReport | null;
  dismissMemoryReport: () => void;
  refreshMemories: () => Promise<{ global: Memory[]; project: Memory[] }>;
  refreshPendingMemories: () => Promise<PendingMemory[]>;
  loadMemories: (scope: MemoryScope, projectId: string | null) => Promise<Memory[]>;
  addMemory: (input: MemoryInput) => Promise<void>;
  queueMemories: (
    notes: string[],
    kind?: MemoryKind,
    trust?: "trusted" | "untrusted",
  ) => Promise<PendingMemory[]>;
  editMemory: (
    id: string,
    draft: MemoryDraft,
    scope?: MemoryScope,
    projectId?: string | null,
  ) => Promise<void>;
  deleteMemory: (id: string, scope?: MemoryScope, projectId?: string | null) => Promise<void>;
  approvePendingMemory: (id: string, content?: string) => Promise<void>;
  approveAllPendingMemories: (rows: PendingMemory[]) => Promise<void>;
  dismissPendingMemory: (id: string) => Promise<void>;
  undoApprovedMemory: (id: string) => Promise<void>;

  conversations: Conversation[];
  activeConversationId: string | null;
  refreshConversations: () => Promise<void>;
  selectConversation: (id: string | null) => Promise<void>;
  newConversation: () => Promise<void>;
  newTemporaryChat: () => Promise<void>;
  removeConversation: (id: string) => Promise<void>;
  renameConversation: (id: string, title: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  moveConversation: (id: string, projectId: string | null) => Promise<void>;

  theme: ThemeMode;
  setTheme: (mode: ThemeMode) => void;
  accent: string;
  setAccent: (value: string) => void;
  fontScale: number;
  setFontScale: (value: number) => void;
  density: Density;
  setDensity: (value: Density) => void;
  groupByDate: boolean;
  setGroupByDate: (value: boolean) => void;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  onboarded: boolean;
  completeOnboarding: () => void;
  displayName: string;
  setDisplayName: (name: string) => void;
  standingPrompt: string;
  setStandingPrompt: (prompt: string) => void;
  showContextBar: boolean;
  setShowContextBar: (value: boolean) => void;
  chatPrompt: string | null;
  setChatPrompt: (id: string, prompt: string | null) => Promise<void>;
  settingsPage: string | null;
  setSettingsPage: (page: string | null) => void;

  messages: Message[];
  streaming: boolean;
  streamingId: string | null;
  workingConversationId: string | null;
  sendMessage: (
    text: string,
    images?: { dataUrl: string }[],
    docs?: ChatDocument[],
  ) => Promise<boolean>;
  fileCommands: FileCommand[];
  loadFileCommands: () => Promise<void>;
  regenerate: () => Promise<void>;
  continueTurn: () => Promise<void>;
  editAndResubmit: (userId: string, text: string) => Promise<boolean>;
  branchFrom: (messageId: string) => Promise<void>;
  messageVersions: Record<string, VersionInfo>;
  switchVersion: (messageId: string, direction: 1 | -1) => Promise<void>;
  rateMessage: (messageId: string, rating: number | null) => Promise<void>;
  clearActiveConversation: () => Promise<void>;
  compactActive: (quiet?: boolean) => Promise<void>;
  uncompactActive: () => Promise<void>;
  compacting: boolean;
  voicePhase: VoicePhase;
  setVoicePhase: (phase: VoicePhase) => void;
  stopStream: () => void;
  composerDraft: string;
  setComposerDraft: (value: string) => void;
  composerSignal: { id: number; text: string | null } | null;
  setComposerText: (text: string) => void;
  sendWith: "enter" | "ctrl";
  setSendWith: (mode: "enter" | "ctrl") => void;
  autoCompact: boolean;
  setAutoCompact: (value: boolean) => void;
  collapseThinking: boolean;
  setCollapseThinking: (value: boolean) => void;
  collapseToolCalls: boolean;
  setCollapseToolCalls: (value: boolean) => void;
  generativeUi: boolean;
  setGenerativeUi: (value: boolean) => void;
  searchBackend: "tavily" | "searxng";
  setSearchBackend: (value: "tavily" | "searxng") => void;
  searchEndpoint: string;
  setSearchEndpoint: (value: string) => void;
  todos: Todo[];
  activeTool: string | null;
  activeStep: { step: number; max: number } | null;
  turnStartedAt: number | null;
  refreshTodos: (conversationId: string | null) => Promise<void>;
  panelOpen: boolean;
  panelArtifact: PanelArtifact | null;
  panelArtifactVersions: ArtifactVersion[];
  panelTab: PanelTab;
  panelMode: PanelMode;
  panelView: PanelView;
  panelWidth: number;
  openArtifact: (artifact: PanelArtifact) => void;
  openSessionPanel: () => void;
  openContextPanel: () => void;
  showSessionView: () => void;
  closePanel: () => void;
  togglePanel: () => void;
  setPanelTab: (tab: PanelTab) => void;
  setPanelMode: (mode: PanelMode) => void;
  setPanelWidth: (width: number) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const resolvedThemeName = useThemeName();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  const [approval, setApproval] = useState<{
    id: string;
    tool: string;
    command: string;
    cwd: string;
    screen: ScreenVerdict | null;
    screenFailed: boolean;
  } | null>(null);
  const [question, setQuestion] = useState<{
    id: string;
    question: string;
    options: string[];
    allowCustom: boolean;
  } | null>(null);

  const reportError = useCallback((cause: unknown) => {
    logEvent("error", cause);
    console.error(cause);
    setError(api.formatInvokeError(cause));
  }, []);

  const [connections, setConnections] = useState<Connection[]>([]);
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(
    () => localStorage.getItem(ACTIVE_CONNECTION_KEY),
  );
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [model, setModelState] = useState(() => localStorage.getItem(MODEL_KEY) ?? "");
  const [visionFallback, setVisionFallbackState] = useState<VisionFallback | null>(() =>
    readVisionFallback(),
  );
  const [visionOverrides, setVisionOverridesState] = useState<Record<string, VisionOverride>>(
    () => readVisionOverrides(),
  );
  const [reasoningEffort, setReasoningEffortState] = useState<string | null>(() =>
    localStorage.getItem("reasoningEffort"),
  );
  const [catalog, setCatalog] = useState<ModelCapabilities[] | null>(null);
  const [hiddenModels, setHiddenModels] = useState<string[]>([]);
  const [displayName, setDisplayNameState] = useState(
    () => localStorage.getItem(DISPLAY_NAME_KEY) ?? "",
  );
  const [standingPrompt, setStandingPromptState] = useState(
    () => localStorage.getItem("standingPrompt") ?? "",
  );
  const [showContextBar, setShowContextBarState] = useState(
    () => localStorage.getItem(SHOW_CONTEXT_BAR_KEY) !== "0",
  );

  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(
    () => localStorage.getItem(ACTIVE_PROJECT_KEY),
  );
  const [view, setView] = useState<View>("chat");
  const [globalMemories, setGlobalMemories] = useState<Memory[]>([]);
  const [projectMemories, setProjectMemories] = useState<Memory[]>([]);
  const [pendingMemories, setPendingMemories] = useState<PendingMemory[]>([]);
  const [memoryOmitted, setMemoryOmitted] = useState(0);
  const [memoryPaused, setMemoryPausedState] = useState(
    () => localStorage.getItem("memoryPaused") === "1",
  );
  const memoryPausedRef = useRef(memoryPaused);
  const relevantMemoriesRef = useRef<Memory[]>([]);
  const recallRequestRef = useRef(0);
  const memoryRefreshRequestRef = useRef(0);
  const knowledgeRequestRef = useRef(0);
  const setMemoryPaused = useCallback((value: boolean) => {
    memoryPausedRef.current = value;
    setMemoryPausedState(value);
    if (value) {
      recallRequestRef.current += 1;
    knowledgeRequestRef.current += 1;
      relevantMemoriesRef.current = [];
      setRecalledMemories([]);
      recalledDetailsRef.current = [];
      setRecalledDetails([]);
    }
    localStorage.setItem("memoryPaused", value ? "1" : "0");
  }, []);
  const [episodicRecall, setEpisodicRecallState] = useState(
    () => localStorage.getItem("episodicRecall") !== "0",
  );
  const episodicRecallRef = useRef(episodicRecall);
  const episodicBlockRef = useRef("");
  const episodeRequestRef = useRef(0);
  const setEpisodicRecall = useCallback((value: boolean) => {
    episodicRecallRef.current = value;
    setEpisodicRecallState(value);
    if (!value) {
      episodicBlockRef.current = "";
      setEpisodeSummary([]);
    }
    localStorage.setItem("episodicRecall", value ? "1" : "0");
  }, []);
  const [memoryCompat, setMemoryCompat] = useState(false);
  const [memoryReport, setMemoryReport] = useState<api.MemoryMigrationReport | null>(null);
  const [recalledDetails, setRecalledDetails] = useState<
    { id: string; score: number }[]
  >([]);
  const recalledDetailsRef = useRef<{ id: string; score: number }[]>([]);
  const [knowledgeSummary, setKnowledgeSummary] = useState<api.KnowledgeHit[]>([]);
  const [episodeSummary, setEpisodeSummary] = useState<api.EpisodeHit[]>([]);
  const knowledgeSummaryRef = useRef<api.KnowledgeHit[]>([]);
  const episodeSummaryRef = useRef<api.EpisodeHit[]>([]);
  useEffect(() => {
    knowledgeSummaryRef.current = knowledgeSummary;
  }, [knowledgeSummary]);
  useEffect(() => {
    episodeSummaryRef.current = episodeSummary;
  }, [episodeSummary]);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageVersions, setMessageVersions] = useState<Record<string, VersionInfo>>({});
  const [fileCommands, setFileCommands] = useState<FileCommand[]>([]);
  const fileCommandsRef = useRef<FileCommand[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [activeStep, setActiveStep] = useState<{ step: number; max: number } | null>(null);
  const [turnStartedAt, setTurnStartedAt] = useState<number | null>(null);
  const [streamConversationId, setStreamConversationId] = useState<string | null>(null);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const streaming =
    streamConversationId !== null && streamConversationId === activeConversationId;
  const workingConversationId = streamConversationId;
  const [compacting, setCompacting] = useState(false);
  const [voicePhase, setVoicePhase] = useState<VoicePhase>("idle");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_KEY) === "1",
  );
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  });
  const [fontScale, setFontScaleState] = useState(() =>
    parseFontScale(localStorage.getItem("fontScale")),
  );
  const [density, setDensityState] = useState<Density>(() =>
    parseDensity(localStorage.getItem("density")),
  );
  const [groupByDate, setGroupByDateState] = useState(() =>
    parseGroupByDate(localStorage.getItem("groupByDate")),
  );

  const activeConnection = useMemo(
    () => connections.find((c) => c.id === activeConnectionId) ?? null,
    [connections, activeConnectionId],
  );
  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) ?? null,
    [projects, activeProjectId],
  );

  const connRef = useRef<Connection | null>(null);
  const projectRef = useRef<Project | null>(null);
  const displayNameRef = useRef("");
  const standingPromptRef = useRef("");
  const chatPromptRef = useRef<string | null>(null);
  const modelRef = useRef(model);
  const convIdRef = useRef<string | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const [composerDraft, setComposerDraftState] = useState(
    () => localStorage.getItem("composerDraft") ?? "",
  );
  const [sendWith, setSendWithState] = useState<"enter" | "ctrl">(() =>
    localStorage.getItem("sendWith") === "ctrl" ? "ctrl" : "enter",
  );
  const [autoCompact, setAutoCompactState] = useState(
    () => localStorage.getItem("autoCompact") !== "0",
  );
  const [collapseThinking, setCollapseThinkingState] = useState(
    () => localStorage.getItem("collapseThinking") !== "0",
  );
  const [collapseToolCalls, setCollapseToolCallsState] = useState(
    () => localStorage.getItem("collapseToolCalls") !== "0",
  );
  const [generativeUi, setGenerativeUiState] = useState(
    () => localStorage.getItem("generativeUi") !== "0",
  );
  const autoCompactRef = useRef(true);
  const autoLatchRef = useRef<{ through: number | null; count: number } | null>(null);
  useEffect(() => {
    autoCompactRef.current = autoCompact;
  }, [autoCompact]);
  const globalMemoriesRef = useRef<Memory[]>([]);
  const projectMemoriesRef = useRef<Memory[]>([]);
  const pendingMemoriesRef = useRef<PendingMemory[]>([]);
  const rollupInFlightRef = useRef<Set<string>>(new Set());
  const rollupAfterStreamRef = useRef<Set<string>>(new Set());
  const globalSentRef = useRef<string[] | null>(null);
  const projectSentRef = useRef<string[] | null>(null);
  const sentOrderRef = useRef<string[] | null>(null);
  const globalSentMemories = memoryPaused
    ? []
    : sentMemories(globalMemories, globalSentRef.current);
  const projectSentMemories = memoryPaused
    ? []
    : sentMemories(projectMemories, projectSentRef.current);
  const orderedDurableMemories = memoryPaused
    ? []
    : orderedSentMemories(globalMemories, projectMemories, sentOrderRef.current);
  const [recalledMemories, setRecalledMemories] = useState<Memory[]>([]);
  const approvedMemoryRef = useRef<Map<string, PendingMemory>>(new Map());
  const requestIdRef = useRef<string | null>(null);
  const streamConversationIdRef = useRef<string | null>(null);
  const turnStartRef = useRef<number | null>(null);
  const priorDurationRef = useRef(0);
  const bufferRef = useRef("");
  const trimNextDeltaRef = useRef(false);
  const reasoningRef = useRef("");
  const thinkingStartRef = useRef<number | null>(null);
  const thinkingMsRef = useRef<number | null>(null);
  const usageRef = useRef<{ prompt: number; completion: number; total: number } | null>(null);
  const finishRef = useRef<string | null>(null);
  const assistantMsgIdRef = useRef<string | null>(null);
  const streamErrorRef = useRef<string | null>(null);

  useEffect(() => {
    connRef.current = activeConnection;
  }, [activeConnection]);
  useEffect(() => {
    projectRef.current = activeProject;
  }, [activeProject]);
  useEffect(() => {
    displayNameRef.current = displayName;
  }, [displayName]);
  useEffect(() => {
    standingPromptRef.current = standingPrompt;
  }, [standingPrompt]);
  useEffect(() => {
    const chat = conversations.find((item) => item.id === activeConversationId);
    chatPromptRef.current = chat?.system_prompt ?? null;
  }, [conversations, activeConversationId]);
  useEffect(() => {
    modelRef.current = model;
  }, [model]);
  const visionFallbackRef = useRef(visionFallback);
  useEffect(() => {
    visionFallbackRef.current = visionFallback;
  }, [visionFallback]);
  useEffect(() => {
    convIdRef.current = activeConversationId;
  }, [activeConversationId]);
  useEffect(() => {
    streamConversationIdRef.current = streamConversationId;
  }, [streamConversationId]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
  const toolLogRef = useRef<ToolEntry[]>([]);
  const artifactsRef = useRef<DeclaredArtifact[]>([]);
  const panelOpenRef = useRef(false);
  const conversationsRef = useRef<Conversation[]>([]);
  useEffect(() => {
    conversationsRef.current = conversations;
  }, [conversations]);
  useEffect(() => {
    globalMemoriesRef.current = globalMemories;
  }, [globalMemories]);
  useEffect(() => {
    projectMemoriesRef.current = projectMemories;
  }, [projectMemories]);
  useEffect(() => {
    pendingMemoriesRef.current = pendingMemories;
  }, [pendingMemories]);

  const refreshConnections = useCallback(
    async (options?: { selectFirst?: boolean }) => {
      const rows = await db.listConnections();
      setConnections(rows);
      setActiveConnectionId((prev) =>
        prev && rows.some((row) => row.id === prev)
          ? prev
          : options?.selectFirst === false
            ? null
            : (rows[0]?.id ?? null),
      );
    },
    [],
  );

  const refreshProjects = useCallback(async () => {
    const rows = await db.listProjects();
    setProjects(rows);
    setActiveProjectId((prev) =>
      prev && rows.some((row) => row.id === prev) ? prev : null,
    );
  }, []);

  const refreshConversations = useCallback(async () => {
    setConversations(await db.listConversations());
  }, []);

  const refreshMemories = useCallback(async () => {
    const request = ++memoryRefreshRequestRef.current;
    const projectId = projectRef.current?.id ?? null;
    relevantMemoriesRef.current = [];
    setRecalledMemories([]);
    let read: Awaited<ReturnType<typeof api.memoryRead>>;
    try {
      read = await api.memoryRead(projectId);
    } catch (e) {
      reportError(e);
      return { global: [], project: [] };
    }
    if (
      request !== memoryRefreshRequestRef.current ||
      (projectRef.current?.id ?? null) !== projectId
    ) {
      return {
        global: globalMemoriesRef.current,
        project: projectMemoriesRef.current,
      };
    }
    if (read.available) {
      const global = read.global.entries.map((entry) =>
        memoryFromEntry(entry, "global", null),
      );
      const project = (read.project?.entries ?? []).map((entry) =>
        memoryFromEntry(entry, "project", projectId),
      );
      setGlobalMemories(global);
      setProjectMemories(project);
      setMemoryCompat(false);
      setMemoryOmitted(read.global.omitted);
      globalSentRef.current = read.global.sent;
      projectSentRef.current = read.project?.sent ?? [];
      sentOrderRef.current = [...read.global.sent, ...(read.project?.sent ?? [])];
      return { global, project };
    }
    const [global, project] = await Promise.all([
      db.listMemories("global", null),
      projectId ? db.listMemories("project", projectId) : Promise.resolve<Memory[]>([]),
    ]);
    if (
      request !== memoryRefreshRequestRef.current ||
      (projectRef.current?.id ?? null) !== projectId
    ) {
      return {
        global: globalMemoriesRef.current,
        project: projectMemoriesRef.current,
      };
    }
    setGlobalMemories(global);
    setProjectMemories(project);
    setMemoryCompat(true);
    setMemoryOmitted(0);
    globalSentRef.current = null;
    projectSentRef.current = null;
    sentOrderRef.current = null;
    return { global, project };
  }, []);

  const refreshPendingMemories = useCallback(async () => {
    const rows = await db.listPendingMemories();
    setPendingMemories(rows);
    return rows;
  }, []);

  /**
   * Rank notes for this turn. The result is discarded if the request is
   * superseded, memory is paused, or the active project changed mid-flight.
   */
  const recallFor = useCallback(
    async (text: string, projectId: string | null): Promise<Memory[]> => {
      const request = ++recallRequestRef.current;
      if (memoryPausedRef.current) {
        relevantMemoriesRef.current = [];
        setRecalledMemories([]);
        return [];
      }
      try {
        const prompt = await api.memoryPrompt(text, projectId);
        if (request !== recallRequestRef.current) return [];
        if (memoryPausedRef.current) return [];
        if ((projectRef.current?.id ?? null) !== projectId) return [];
        globalSentRef.current = prompt.items
          .filter((hit) => hit.scope === "global")
          .map((hit) => hit.id);
        projectSentRef.current = prompt.items
          .filter((hit) => projectId !== null && hit.scope === `project:${projectId}`)
          .map((hit) => hit.id);
        sentOrderRef.current = prompt.items
          .filter(
            (hit) =>
              hit.scope === "global" ||
              (projectId !== null && hit.scope === `project:${projectId}`),
          )
          .map((hit) => hit.id);
        setMemoryOmitted(prompt.omitted);
        const recalled: Memory[] = [];
        for (const hit of prompt.items) {
          const inProject =
            projectId !== null && hit.scope === `project:${projectId}`;
          if (hit.scope !== "global" && !inProject) continue;
          const kind = (
            ["fact", "preference", "summary", "note"] as const
          ).includes(hit.kind as "fact" | "preference" | "summary" | "note")
            ? (hit.kind as Memory["kind"])
            : "note";
          const stamp = Date.parse(hit.date) || Date.now();
          recalled.push({
            id: hit.id,
            scope: inProject ? "project" : "global",
            project_id: inProject ? projectId : null,
            kind,
            content: hit.text,
            created_at: stamp,
            updated_at: stamp,
          });
        }
        relevantMemoriesRef.current = [];
        setRecalledMemories(recalled);
        const details = recalled.map((memory) => ({
          id: memory.id,
          score: prompt.items.find((hit) => hit.id === memory.id)?.score ?? 0,
        }));
        recalledDetailsRef.current = details;
        setRecalledDetails(details);
        return recalled;
      } catch (error) {
        if (
          request !== recallRequestRef.current ||
          (projectRef.current?.id ?? null) !== projectId
        ) {
          return [];
        }
        console.warn("memory: recall failed", error);
        globalSentRef.current = [];
        projectSentRef.current = [];
        sentOrderRef.current = [];
        setMemoryOmitted(globalMemoriesRef.current.length + projectMemoriesRef.current.length);
        relevantMemoriesRef.current = [];
        setRecalledMemories([]);
        recalledDetailsRef.current = [];
        setRecalledDetails([]);
        return [];
      }
    },
    [],
  );

  /**
   * Rank past-chat snippets for this turn. Project chats only, and the result
   * is dropped when the switch is off or the project changed mid-flight.
   */
  const recallEpisodes = useCallback(
    async (
      text: string,
      projectId: string | null,
      conversationId: string | null,
    ): Promise<api.EpisodeHit[]> => {
      const request = ++episodeRequestRef.current;
      if (!projectId || !episodicRecallRef.current) {
        episodicBlockRef.current = "";
        setEpisodeSummary([]);
        return [];
      }
      try {
        const hits = await api.episodicRecall(text, projectId, conversationId);
        if (request !== episodeRequestRef.current) return [];
        if (!episodicRecallRef.current) return [];
        if ((projectRef.current?.id ?? null) !== projectId) return [];
        if (conversationId !== null && convIdRef.current !== conversationId) return [];
        const budget = promptBudget(contextLimitRef.current);
        const rendered = selectEpisodeHits(hits, budget.episodes);
        episodicBlockRef.current = buildEpisodeBlock(rendered, budget.episodes);
        setEpisodeSummary(rendered);
        return rendered;
      } catch (error) {
        console.warn("episodes: recall failed", error);
        if (request === episodeRequestRef.current) {
          episodicBlockRef.current = "";
          setEpisodeSummary([]);
        }
        return [];
      }
    },
    [],
  );

  /** Record what this turn actually injected, for the inspector and the audit. */
  const auditTurn = useCallback(
    (
      conversationId: string,
      query: string,
      recalled: Memory[],
      knowledge: api.KnowledgeHit[],
      episodes: api.EpisodeHit[],
    ) => {
      if (knowledge.length > 0 || episodes.length > 0) {
        markRollupUntrusted(conversationId);
      }
      const scores = new Map(
        recalledDetailsRef.current.map((detail) => [detail.id, detail.score]),
      );
      const items: {
        source: string;
        item_id: string;
        label: string;
        score?: number;
        trust?: string;
      }[] = [];
      const durableIds = new Set<string>();
      if (!memoryPausedRef.current) {
        for (const memory of orderedSentMemories(
          globalMemoriesRef.current,
          projectMemoriesRef.current,
          sentOrderRef.current,
        )) {
          durableIds.add(memory.id);
          items.push({
            source: "durable",
            item_id: memory.id,
            label: memory.content.slice(0, 120),
          });
        }
        for (const memory of recalled) {
          if (durableIds.has(memory.id)) continue;
          items.push({
            source: "recalled",
            item_id: memory.id,
            label: memory.content.slice(0, 120),
            score: scores.get(memory.id),
          });
        }
      }
      for (const hit of knowledge) {
        items.push({
          source: "knowledge",
          item_id: `${hit.doc_id}:${hit.ord}`,
          label: `${hit.name}${hit.heading ? ` — ${hit.heading}` : ""}`,
          score: hit.score,
        });
      }
      for (const hit of episodes) {
        items.push({
          source: "episode",
          item_id: hit.message_id,
          label: `${hit.title} (${hit.date})`,
          score: hit.score,
        });
      }
      if (items.length === 0) return;
      void api
        .memoryAuditWrite({ conversation_id: conversationId, query, items })
        .catch((error: unknown) => console.warn("audit: write failed", error));
    },
    [],
  );

  useEffect(() => {
    (async () => {
      try {
        await refreshConnections();
        await refreshProjects();
        try {
          const report = await api.memoryMigrate();
          if (report.migrated && (report.notes > 0 || report.unassigned > 0)) {
            setMemoryReport(report);
          }
        } catch (e) {
          reportError(e);
        }
        await refreshMemories();
        await refreshPendingMemories();
        await db.sweepTemporaryConversations();
        setConversations(await db.listConversations());
      } catch (e) {
        reportError(e);
      } finally {
        setReady(true);
      }
    })();
  }, [refreshConnections, refreshProjects, refreshMemories, refreshPendingMemories]);

  useEffect(() => {
    const onError = (event: ErrorEvent) => logEvent("window.error", event.message);
    const onRejection = (event: PromiseRejectionEvent) =>
      logEvent("unhandledrejection", event.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  useEffect(() => {
    void refreshMemories();
  }, [activeProjectId, refreshMemories]);

  useEffect(() => {
    if (activeConnectionId) {
      localStorage.setItem(ACTIVE_CONNECTION_KEY, activeConnectionId);
    } else {
      localStorage.removeItem(ACTIVE_CONNECTION_KEY);
    }
  }, [activeConnectionId]);

  useEffect(() => {
    if (activeProjectId) {
      localStorage.setItem(ACTIVE_PROJECT_KEY, activeProjectId);
    } else {
      localStorage.removeItem(ACTIVE_PROJECT_KEY);
    }
  }, [activeProjectId]);

  useEffect(() => {
    if (model) {
      localStorage.setItem(MODEL_KEY, model);
    } else {
      localStorage.removeItem(MODEL_KEY);
    }
  }, [model]);

  useEffect(() => {
    localStorage.setItem(THEME_KEY, theme);
    const apply = () => {
      const dark =
        theme === "dark" ||
        (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
      document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    };
    apply();
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    query.addEventListener("change", apply);
    return () => query.removeEventListener("change", apply);
  }, [theme]);

  const setTheme = useCallback((mode: ThemeMode) => setThemeState(mode), []);

  const setFontScale = useCallback((value: number) => {
    const next = clampFontScale(value);
    setFontScaleState(next);
    localStorage.setItem("fontScale", String(next));
  }, []);

  const setDensity = useCallback((value: Density) => {
    setDensityState(value);
    localStorage.setItem("density", value);
  }, []);

  const setGroupByDate = useCallback((value: boolean) => {
    setGroupByDateState(value);
    localStorage.setItem("groupByDate", value ? "1" : "0");
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("--font-scale", String(fontScale));
  }, [fontScale]);

  useEffect(() => {
    document.documentElement.setAttribute("data-density", density);
  }, [density]);

  const [accent, setAccentState] = useState(() => parseAccent(localStorage.getItem("accent")));
  const setAccent = useCallback((value: string) => {
    const id = accentIdOf(value);
    setAccentState(id);
    localStorage.setItem("accent", id);
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-accent", accent);
  }, [accent]);

  const setComposerDraft = useCallback((value: string) => {
    setComposerDraftState(value);
    if (value) {
      localStorage.setItem("composerDraft", value);
    } else {
      localStorage.removeItem("composerDraft");
    }
  }, []);

  const [composerSignal, setComposerSignal] = useState<{
    id: number;
    text: string | null;
  } | null>(null);
  const signalId = useRef(0);

  const setComposerText = useCallback(
    (text: string) => {
      setComposerDraft(text);
      signalId.current += 1;
      setComposerSignal({ id: signalId.current, text });
    },
    [setComposerDraft],
  );

  const setSendWith = useCallback((mode: "enter" | "ctrl") => {
    setSendWithState(mode);
    localStorage.setItem("sendWith", mode);
  }, []);

  const setAutoCompact = useCallback((value: boolean) => {
    setAutoCompactState(value);
    localStorage.setItem("autoCompact", value ? "1" : "0");
  }, []);

  const setCollapseThinking = useCallback((value: boolean) => {
    setCollapseThinkingState(value);
    localStorage.setItem("collapseThinking", value ? "1" : "0");
  }, []);

  const setCollapseToolCalls = useCallback((value: boolean) => {
    setCollapseToolCallsState(value);
    localStorage.setItem("collapseToolCalls", value ? "1" : "0");
  }, []);

  const setGenerativeUi = useCallback((value: boolean) => {
    setGenerativeUiState(value);
    localStorage.setItem("generativeUi", value ? "1" : "0");
  }, []);

  const [searchBackend, setSearchBackendState] = useState<"tavily" | "searxng">(
    () => (localStorage.getItem("searchBackend") === "searxng" ? "searxng" : "tavily"),
  );
  const setSearchBackend = useCallback((value: "tavily" | "searxng") => {
    setSearchBackendState(value);
    localStorage.setItem("searchBackend", value);
  }, []);
  const [searchEndpoint, setSearchEndpointState] = useState(
    () => localStorage.getItem("searchEndpoint") ?? "http://127.0.0.1:8888",
  );
  const setSearchEndpoint = useCallback((value: string) => {
    setSearchEndpointState(value);
    localStorage.setItem("searchEndpoint", value);
  }, []);

  const setDisplayName = useCallback((name: string) => {
    setDisplayNameState(name);
    if (name.trim()) {
      localStorage.setItem(DISPLAY_NAME_KEY, name.trim());
    } else {
      localStorage.removeItem(DISPLAY_NAME_KEY);
    }
  }, []);

  const setStandingPrompt = useCallback((prompt: string) => {
    setStandingPromptState(prompt);
    if (prompt.trim()) {
      localStorage.setItem("standingPrompt", prompt);
    } else {
      localStorage.removeItem("standingPrompt");
    }
  }, []);

  const setShowContextBar = useCallback((value: boolean) => {
    setShowContextBarState(value);
    localStorage.setItem(SHOW_CONTEXT_BAR_KEY, value ? "1" : "0");
  }, []);

  const toggleSidebar = useCallback(() => {
    setSidebarCollapsed((prev) => {
      localStorage.setItem(SIDEBAR_KEY, prev ? "0" : "1");
      return !prev;
    });
  }, []);

  const [paletteOpen, setPaletteOpenState] = useState(false);
  const setPaletteOpen = useCallback((open: boolean) => setPaletteOpenState(open), []);
  const [onboarded, setOnboarded] = useState(() => localStorage.getItem("onboarded") === "1");
  const completeOnboarding = useCallback(() => {
    localStorage.setItem("onboarded", "1");
    setOnboarded(true);
  }, []);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelArtifact, setPanelArtifact] = useState<PanelArtifact | null>(null);
  const [panelArtifactVersions, setPanelArtifactVersions] = useState<ArtifactVersion[]>([]);
  const [artifactVersionRevision, setArtifactVersionRevision] = useState(0);
  const [panelTab, setPanelTabState] = useState<PanelTab>("code");
  const [panelMode, setPanelModeState] = useState<PanelMode>("dock");
  const [panelView, setPanelViewState] = useState<PanelView>("session");
  const [panelWidth, setPanelWidthState] = useState(() => {
    const saved = Number(localStorage.getItem(PANEL_WIDTH_KEY));
    return clampPanelWidth(Number.isFinite(saved) && saved > 0 ? saved : 400);
  });

  const setPanelWidth = useCallback((width: number) => {
    const clamped = clampPanelWidth(width);
    setPanelWidthState(clamped);
    localStorage.setItem(PANEL_WIDTH_KEY, String(clamped));
  }, []);

  const setPanelMode = useCallback((mode: PanelMode) => {
    setPanelModeState(mode);
  }, []);

  useEffect(() => {
    panelOpenRef.current = panelOpen;
  }, [panelOpen]);

  const openArtifact = useCallback((artifact: PanelArtifact) => {
    setPanelModeState((mode) => (mode === "mini" ? "dock" : mode));
    setPanelArtifact(artifact);
    setPanelViewState("artifact");
    setPanelTabState(defaultPanelTab(artifact.lang));
    setPanelOpen(true);
  }, []);

  useEffect(() => {
    const artifact = panelArtifact;
    const conversationId = convIdRef.current;
    if (!artifact?.messageId || !artifact.locator || !conversationId) {
      setPanelArtifactVersions([]);
      return;
    }
    let live = true;
    void db
      .listMessageTree(conversationId)
      .then((rows) => {
        if (live) {
          setPanelArtifactVersions(
            artifactVersions(artifact.messageId as string, artifact.locator as ArtifactLocator, rows),
          );
        }
      })
      .catch((error: unknown) => {
        if (live) {
          setPanelArtifactVersions([]);
          console.warn("artifact versions: read failed", error);
        }
      });
    return () => {
      live = false;
    };
  }, [artifactVersionRevision, panelArtifact, messageVersions]);

  const openSessionPanel = useCallback(() => {
    if (!panelOpenRef.current) setPanelModeState("dock");
    setPanelViewState("session");
    setPanelOpen(true);
  }, []);

  const openContextPanel = useCallback(() => {
    if (!panelOpenRef.current) setPanelModeState("dock");
    setPanelViewState("context");
    setPanelOpen(true);
  }, []);

  const showSessionView = useCallback(() => setPanelViewState("session"), []);

  const closePanel = useCallback(() => setPanelOpen(false), []);

  const togglePanel = useCallback(() => {
    if (panelOpenRef.current) {
      setPanelOpen(false);
      return;
    }
    setPanelModeState("dock");
    if (panelArtifact === null) setPanelViewState("session");
    setPanelOpen(true);
  }, [panelArtifact]);

  const setPanelTab = useCallback((tab: PanelTab) => setPanelTabState(tab), []);
  const [settingsPage, setSettingsPage] = useState<string | null>(null);

  const refreshModels = useCallback(async (force = false) => {
    const connection = connRef.current;
    if (!connection) {
      setModels([]);
      return;
    }
    try {
      const has =
        KEYLESS_KINDS.has(connection.kind) || (await api.hasApiKey(connection.id));
      if (!has) {
        setModels([]);
        return;
      }
      setLoadingModels(true);
      const [list, hidden] = await Promise.all([
        api.listModels(connection.id, connection.kind, force),
        db.listHiddenModels(connection.id),
      ]);
      if (connRef.current?.id !== connection.id) return;
      const hiddenSet = new Set(hidden);
      const visible = list.filter((id) => !hiddenSet.has(id));
      setHiddenModels(hidden);
      setModels(visible);
      if (!modelRef.current && visible.length > 0) {
        setModelState(visible[0]);
      }
      if (force) {
        const caps = await api
          .listModelCaps(connection.id, connection.kind)
          .catch(() => null);
        if (caps && connRef.current?.id === connection.id) setCatalog(caps);
      }
    } catch (e) {
      setModels([]);
      reportError(e);
    } finally {
      setLoadingModels(false);
    }
  }, []);

  useEffect(() => {
    if (ready) void refreshModels();
  }, [ready, activeConnection, refreshModels]);

  useEffect(() => {
    if (!activeConnection) {
      setCatalog(null);
      return;
    }
    let live = true;
    setCatalog(null);
    api
      .listModelCaps(activeConnection.id, activeConnection.kind)
      .then((rows) => {
        if (live) setCatalog(rows);
      })
      .catch(() => {
        if (live) setCatalog(null);
      });
    return () => {
      live = false;
    };
  }, [activeConnection]);

  const toggleModelVisibility = useCallback(
    async (connectionId: string, modelId: string, hidden: boolean) => {
      if (hidden) {
        await db.hideModel(connectionId, modelId);
      } else {
        await db.unhideModel(connectionId, modelId);
      }
      if (connectionId === connRef.current?.id) {
        await refreshModels();
      }
    },
    [refreshModels],
  );

  const setAllModelsVisibility = useCallback(
    async (connectionId: string, modelIds: string[], hidden: boolean) => {
      if (hidden) {
        await db.hideAllModels(connectionId, modelIds);
      } else {
        await db.unhideAllModels(connectionId);
      }
      if (connectionId === connRef.current?.id) {
        await refreshModels();
      }
    },
    [refreshModels],
  );

  const selectConnection = useCallback((id: string | null) => {
    setActiveConnectionId(id);
    setModels([]);
    setModelState("");
  }, []);

  const saveConnection = useCallback(
    async (
      input: ConnectionInput,
      id?: string,
      options?: { activate?: boolean },
    ): Promise<Connection> => {
      const activate = options?.activate ?? true;
      let saved: Connection;
      if (id) {
        const existing = connections.find((c) => c.id === id) ?? (await db.getConnection(id));
        if (!existing) throw new Error("Connection no longer exists");
        saved = { ...existing, ...input };
        await db.updateConnection(saved);
      } else {
        saved = await db.createConnection(input);
        if (activate) setActiveConnectionId(saved.id);
      }
      api.clearModelCache(saved.id);
      await refreshConnections({ selectFirst: activate });
      return saved;
    },
    [connections, refreshConnections],
  );

  const removeConnection = useCallback(
    async (id: string) => {
      await api.deleteApiKey(id).catch(() => undefined);
      await db.deleteConnection(id);
      api.clearModelCache(id);
      if (activeConnectionId === id) setActiveConnectionId(null);
      await refreshConnections();
    },
    [activeConnectionId, refreshConnections],
  );

  const setModel = useCallback((value: string) => setModelState(value), []);

  const setVisionFallback = useCallback((value: VisionFallback | null) => {
    writeVisionFallback(value);
    setVisionFallbackState(value);
  }, []);

  const setModelVisionOverride = useCallback(
    (connectionId: string | null, modelId: string, value: VisionOverride) => {
      writeVisionOverride(connectionId, modelId, value);
      setVisionOverridesState((previous) =>
        withVisionOverride(previous, connectionId, modelId, value),
      );
    },
    [],
  );

  const modelVisionOverride = useCallback(
    (connectionId: string | null, modelId: string) =>
      visionOverrideFor(visionOverrides, connectionId, modelId),
    [visionOverrides],
  );

  const canSeeImages = useCallback(
    (connectionId: string | null, modelId: string) =>
      canSeeFor(catalog, visionOverrides, activeConnectionId, connectionId, modelId),
    [activeConnectionId, catalog, visionOverrides],
  );

  const loadAllModelOptions = useCallback(
    () => collectModelOptions(connections, reportError),
    [connections, reportError],
  );

  const loadFileCommands = useCallback(async () => {
    try {
      const { rows, invalid } = parseFileCommands(
        await api.listCommands(projectRef.current?.id ?? null),
      );
      if (invalid > 0) toast(`${invalid} command file(s) skipped (invalid).`);
      fileCommandsRef.current = rows;
      setFileCommands(rows);
    } catch {
      toast("Couldn't load file commands.");
    }
  }, []);

  const setReasoningEffort = useCallback((effort: string | null) => {
    setReasoningEffortState(effort);
    if (effort) {
      localStorage.setItem("reasoningEffort", effort);
    } else {
      localStorage.removeItem("reasoningEffort");
    }
  }, []);

  const reasoningEffortRef = useRef<string | null>(null);
  useEffect(() => {
    reasoningEffortRef.current = reasoningEffort;
  }, [reasoningEffort]);

  const supportedEfforts = useMemo(
    () => (model ? lookupEfforts(catalog, model, activeConnection?.kind) : null),
    [catalog, model, activeConnection],
  );
  const supportedEffortsRef = useRef<string[] | null>(null);
  useEffect(() => {
    supportedEffortsRef.current = supportedEfforts;
  }, [supportedEfforts]);
  const catalogRef = useRef<ModelCapabilities[] | null>(null);
  useEffect(() => {
    catalogRef.current = catalog;
  }, [catalog]);

  const modelContextLimit = useMemo(
    () => (model ? (lookupContextLength(catalog, model) ?? null) : null),
    [catalog, model],
  );
  const contextLimitRef = useRef(DEFAULT_MODEL_CONTEXT);
  useEffect(() => {
    contextLimitRef.current = modelContextLimit ?? DEFAULT_MODEL_CONTEXT;
  }, [modelContextLimit]);

  const lastPayloadRef = useRef<PayloadTurn[] | null>(null);
  const knowledgeBlockRef = useRef("");
  const skillIndexRef = useRef("");
  const pendingVisionFallbackRef = useRef<VisionFallback | null>(null);

  const contextInfo = useMemo(() => {
    const base = buildSystemPrompt({
      globalMemories: orderedDurableMemories,
      project: activeProject,
      projectMemories: [],
      relevantMemories: [],
      episodicBlock: episodicRecall ? episodicBlockRef.current || undefined : undefined,
      userName: displayName || undefined,
      standingPrompt: standingPrompt || undefined,
      chatPrompt: conversations.find((item) => item.id === activeConversationId)?.system_prompt ?? undefined,
      knowledgeBlock: knowledgeBlockRef.current || undefined,
      skillIndexBlock: skillIndexRef.current || undefined,
      openuiPrompt: generativeUi ? OPENUI_SYSTEM_PROMPT : undefined,
      themePrompt: visualThemePrompt(
        readVisualTheme({ mode: resolvedThemeName, accentId: accent }),
      ),
      contextLimit: modelContextLimit ?? DEFAULT_MODEL_CONTEXT,
      now: new Date(),
    });
    const system = base;
    const limitKnown = modelContextLimit != null;
    const limit = modelContextLimit ?? DEFAULT_MODEL_CONTEXT;
    const lastUsage = [...messages]
      .reverse()
      .find((m) => m.role === "assistant" && m.total_tokens != null);
    if (lastUsage?.total_tokens != null) {
      const tokens = lastUsage.total_tokens;
      return {
        tokens,
        limit,
        pct: Math.min(100, Math.round((tokens / limit) * 100)),
        real: true,
        limitKnown,
        lastIn: lastUsage.prompt_tokens ?? null,
        lastOut: lastUsage.completion_tokens ?? null,
        prompt: system ?? "",
      };
    }
    const estimated = estimateContext(
      messages.filter((m) => m.content.length > 0),
      system,
      limit,
    );
    return {
      ...estimated,
      pct: estimated.pct,
      real: false,
      limitKnown,
      lastIn: null,
      lastOut: null,
      prompt: system ?? "",
    };
  }, [
    messages,
    globalSentMemories,
    activeProject,
    projectSentMemories,
    orderedDurableMemories,
    recalledMemories,
    memoryPaused,
    episodicRecall,
    displayName,
    standingPrompt,
    conversations,
    activeConversationId,
    modelContextLimit,
    generativeUi,
    resolvedThemeName,
    accent,
  ]);

  const resolveEffort = useCallback((): string | null => {
    const selected = reasoningEffortRef.current;
    if (!selected) return null;
    const supported = supportedEffortsRef.current;
    if (!supported || !supported.includes(selected)) return null;
    return selected;
  }, []);

  const resolveTools = useCallback((): boolean => {
    const connection = connRef.current;
    const modelName = modelRef.current;
    if (!connection || !modelName) return false;
    return lookupSupportsTools(catalogRef.current, modelName, connection.kind);
  }, []);

  const saveProject = useCallback(
    async (input: ProjectInput, id?: string): Promise<Project> => {
      let saved: Project;
      if (id) {
        const existing = projects.find((p) => p.id === id);
        if (!existing) throw new Error("Project no longer exists");
        saved = { ...existing, ...input };
        await db.updateProject(saved);
      } else {
        saved = await db.createProject(input);
        setActiveProjectId(saved.id);
      }
      await refreshProjects();
      return saved;
    },
    [projects, refreshProjects],
  );

  const removeProject = useCallback(
    async (id: string) => {
      if (!memoryCompat) {
        await api.memoryProjectDelete(id).catch(reportError);
      }
      await api.knowledgePurgeProject(id).catch(reportError);
      await db.deleteProject(id);
      if (activeProjectId === id) setActiveProjectId(null);
      await refreshProjects();
      await refreshMemories();
      setConversations(await db.listConversations());
    },
    [activeProjectId, memoryCompat, refreshProjects, refreshMemories],
  );

  const saveMemoryToScope = useCallback(
    async (input: MemoryInput) => {
      const parsed = memoryInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? "Invalid memory");
      }
      if (memoryCompat) {
        await db.createMemory(parsed.data);
      } else {
        await api.memoryAppend({
          scope: parsed.data.scope,
          projectId: parsed.data.scope === "project" ? parsed.data.project_id : null,
          text: parsed.data.content,
          kind: parsed.data.kind,
        });
      }
      await refreshMemories();
    },
    [memoryCompat, refreshMemories],
  );

  const queueMemories = useCallback(
    async (
      notes: string[],
      kind: MemoryKind = "fact",
      trust: "trusted" | "untrusted" = "trusted",
    ): Promise<PendingMemory[]> => {
      const scope: MemoryScope = activeProject ? "project" : "global";
      const projectId = activeProject ? activeProject.id : null;
      const now = Date.now();
      const rows: PendingMemory[] = [];
      for (const raw of notes) {
        const content = raw.replace(/\s+/g, " ").trim().slice(0, 2000);
        if (!content) continue;
        await api.memoryValidate(content);
        rows.push({
          id: newId(),
          scope,
          project_id: projectId,
          kind,
          content,
          conversation_id: activeConversationId,
          created_at: now,
          trust,
        });
      }
      if (rows.length > 0) {
        await db.addPendingMemories(rows);
        await refreshPendingMemories();
      }
      return rows;
    },
    [activeConversationId, activeProject, refreshPendingMemories],
  );

  const rollupConversation = useCallback(
    async (
      conversationId: string,
      projectId: string,
      reason: RollupReason,
    ): Promise<void> => {
      if (rollupInFlightRef.current.has(conversationId)) return;
      const connection = connRef.current;
      const modelName = modelRef.current;
      if (!connection || !modelName) return;
      const conversation = conversationsRef.current.find((item) => item.id === conversationId);
      if (!conversation || conversation.temporary || conversation.project_id !== projectId) return;
      rollupInFlightRef.current.add(conversationId);
      try {
        const messages = await db.listMessages(conversationId);
        const through = messages.reduce(
          (latest, message) =>
            Math.max(latest, message.created_at, message.completed_at ?? 0),
          0,
        );
        const marker = `memoryRollup:${conversationId}`;
        const prior = Number(localStorage.getItem(marker) ?? 0);
        if (through === 0 || through <= prior) return;
        const transcript = rollupTranscript(messages);
        if (!transcript) return;
        const raw = await api.extractMemory(
          connection.id,
          modelName,
          transcript,
          connection.kind,
          "project_rollup",
        );
        let saved: string[];
        try {
          const read = await api.memoryRead(projectId);
          saved = read.available
            ? (read.project?.entries ?? []).map((entry) => entry.text)
            : (await db.listMemories("project", projectId)).map((memory) => memory.content);
        } catch (error) {
          console.warn("memory: project roll-up dedupe read failed", error);
          saved = projectMemoriesRef.current
            .filter((memory) => memory.project_id === projectId)
            .map((memory) => memory.content);
        }
        const pending = await db.listPendingMemories();
        const existing = [
          ...saved,
          ...pending
            .filter((memory) => memory.project_id === projectId)
            .map((memory) => memory.content),
        ];
        const proposals = projectScopedNotes(
          uniqueRollupNotes(parseExtractedNotes(raw), existing),
        );
        const safe: string[] = [];
        for (const proposal of proposals) {
          try {
            await api.memoryValidate(proposal);
            safe.push(proposal);
          } catch (error) {
            console.warn("memory: rejected roll-up proposal", error);
          }
        }
        if (safe.length > 0) {
          const createdAt = Date.now();
          const trust =
            hasUntrustedProvenance(messages) || wasRollupUntrusted(conversationId)
              ? "untrusted"
              : "trusted";
          await db.addPendingMemories(
            safe.map((content, index): PendingMemory => ({
              id: newId(),
              scope: "project",
              project_id: projectId,
              kind: "summary",
              content,
              conversation_id: conversationId,
              created_at: createdAt + index,
              trust,
            })),
          );
          await refreshPendingMemories();
          toast(`${safe.length} project ${safe.length === 1 ? "note" : "notes"} waiting for review.`);
        }
        localStorage.setItem(marker, String(through));
      } catch (error) {
        console.warn(`memory: ${reason} roll-up failed`, error);
      } finally {
        rollupInFlightRef.current.delete(conversationId);
      }
    },
    [refreshPendingMemories],
  );

  const leaveConversation = useCallback(
    (conversationId: string | null) => {
      if (!conversationId) return;
      const conversation = conversationsRef.current.find((item) => item.id === conversationId);
      if (!conversation?.project_id) return;
      const userMessages = messagesRef.current.filter((message) => message.role === "user");
      const reason = rollupReason({
        projectId: conversation.project_id,
        leaving: true,
        userTurns: userMessages.length,
        userText: userMessages[userMessages.length - 1]?.content ?? "",
      });
      if (!reason) return;
      if (streamConversationIdRef.current === conversationId) {
        rollupAfterStreamRef.current.add(conversationId);
        return;
      }
      void rollupConversation(conversationId, conversation.project_id, reason);
    },
    [rollupConversation],
  );

  const scheduleTurnRollup = useCallback(
    (conversationId: string, projectId: string | null, userTurns: number, userText: string) => {
      const reason = rollupReason({
        projectId,
        leaving: false,
        userTurns,
        userText,
      });
      if (reason && projectId) void rollupConversation(conversationId, projectId, reason);
    },
    [rollupConversation],
  );

  const selectProject = useCallback(
    (id: string | null) => {
      leaveConversation(convIdRef.current);
      setActiveProjectId(id);
      setActiveConversationId(null);
      setMessages([]);
      setError(null);
      setView(id ? "project" : "chat");
      recallRequestRef.current += 1;
      memoryRefreshRequestRef.current += 1;
      knowledgeRequestRef.current += 1;
      episodeRequestRef.current += 1;
      relevantMemoriesRef.current = [];
      episodicBlockRef.current = "";
      setRecalledMemories([]);
      recalledDetailsRef.current = [];
      setRecalledDetails([]);
      knowledgeBlockRef.current = "";
      setKnowledgeSummary([]);
      setEpisodeSummary([]);
      lastPayloadRef.current = null;
    },
    [leaveConversation],
  );

  const editMemory = useCallback(
    async (
      id: string,
      draft: MemoryDraft,
      scope?: MemoryScope,
      projectId?: string | null,
    ) => {
      const target = [...globalMemoriesRef.current, ...projectMemoriesRef.current].find(
        (memory) => canonicalMemoryId(memory.id) === canonicalMemoryId(id),
      );
      if (memoryCompat) {
        await db.updateMemory(id, draft.content.trim(), draft.kind);
      } else {
        const written = await api.memoryUpdate({
          scope: scope ?? target?.scope ?? "global",
          projectId: scope ? (projectId ?? null) : (target?.project_id ?? null),
          id: target?.id ?? id,
          text: draft.content.trim(),
          kind: draft.kind,
        });
        if (!written) throw new Error("That memory is not in the file anymore");
      }
      await refreshMemories();
    },
    [memoryCompat, refreshMemories],
  );

  const deleteMemory = useCallback(
    async (id: string, scope?: MemoryScope, projectId?: string | null) => {
      const target = [...globalMemoriesRef.current, ...projectMemoriesRef.current].find(
        (memory) => canonicalMemoryId(memory.id) === canonicalMemoryId(id),
      );
      if (memoryCompat) {
        await db.deleteMemory(id);
      } else {
        await api.memoryForget(
          scope ?? target?.scope ?? "global",
          scope ? (projectId ?? null) : (target?.project_id ?? null),
          target?.id ?? id,
        );
      }
      await refreshMemories();
    },
    [memoryCompat, refreshMemories],
  );

  const approvePendingMemory = useCallback(
    async (id: string, content?: string) => {
      const edited = content?.trim();
      if (memoryCompat) {
        if (edited) await db.updatePendingMemory(id, edited);
        await db.approvePendingMemory(id);
      } else {
        const rows = await db.listPendingMemories();
        const row = rows.find((pending) => pending.id === id);
        if (!row) throw new Error("That memory is already gone");
        const text = edited || row.content;
        await api.memoryAppend({
          scope: row.scope,
          projectId: row.project_id,
          text,
          kind: row.kind,
          id: row.id,
          date: undefined,
          trust: row.trust,
        });
        approvedMemoryRef.current.set(id, { ...row, content: text });
        await db.dismissPendingMemory(id);
      }
      await Promise.all([refreshMemories(), refreshPendingMemories()]);
    },
    [memoryCompat, refreshMemories, refreshPendingMemories],
  );

  const dismissPendingMemory = useCallback(
    async (id: string) => {
      await db.dismissPendingMemory(id);
      await refreshPendingMemories();
    },
    [refreshPendingMemories],
  );

  const approveAllPendingMemories = useCallback(
    async (rows: PendingMemory[]) => {
      if (rows.length === 0) return;
      if (memoryCompat) {
        for (const row of rows) await db.approvePendingMemory(row.id);
      } else {
        for (const row of rows) {
          await api.memoryAppend({
            scope: row.scope,
            projectId: row.project_id,
            text: row.content,
            kind: row.kind,
            id: row.id,
            date: undefined,
            trust: row.trust,
          });
          approvedMemoryRef.current.set(row.id, row);
          await db.dismissPendingMemory(row.id);
        }
      }
      await Promise.all([refreshMemories(), refreshPendingMemories()]);
    },
    [memoryCompat, refreshMemories, refreshPendingMemories],
  );

  const undoApprovedMemory = useCallback(
    async (id: string) => {
      if (memoryCompat) {
        await db.restorePendingMemory(id);
      } else {
        const approved = approvedMemoryRef.current.get(id);
        const target = [...globalMemoriesRef.current, ...projectMemoriesRef.current].find(
          (memory) => canonicalMemoryId(memory.id) === canonicalMemoryId(id),
        );
        const scope = approved?.scope ?? target?.scope;
        if (scope) {
          await api.memoryForget(
            scope,
            approved?.project_id ?? target?.project_id ?? null,
            target?.id ?? id,
          );
          if (approved) await db.addPendingMemory(approved);
        }
        approvedMemoryRef.current.delete(id);
      }
      await Promise.all([refreshMemories(), refreshPendingMemories()]);
    },
    [memoryCompat, refreshMemories, refreshPendingMemories],
  );

  const loadMemories = useCallback(
    async (scope: MemoryScope, projectId: string | null): Promise<Memory[]> => {
      if (!memoryCompat) {
        try {
          const read = await api.memoryRead(scope === "project" ? projectId : null);
          const view = scope === "project" ? read.project : read.global;
          if (view) {
            return view.entries.map((entry) =>
              memoryFromEntry(entry, scope, scope === "project" ? projectId : null),
            );
          }
        } catch (e) {
          reportError(e);
        }
      }
      return db.listMemories(scope, projectId);
    },
    [memoryCompat],
  );

  const discardTemporary = useCallback(async () => {
    const active = conversationsRef.current.find((c) => c.id === convIdRef.current);
    if (!active?.temporary) return;
    try {
      await db.deleteConversation(active.id);
    } catch (e) {
      reportError(e);
      return;
    }
    setConversations((prev) => prev.filter((c) => c.id !== active.id));
  }, [reportError]);

  const selectConversation = useCallback(async (id: string | null) => {
    const previousId = convIdRef.current;
    if (id !== previousId) leaveConversation(previousId);
    if (id !== convIdRef.current) await discardTemporary();
    setActiveConversationId(id);
    setError(null);
    setCanRetry(false);
    setView("chat");
    recallRequestRef.current += 1;
    knowledgeRequestRef.current += 1;
    episodeRequestRef.current += 1;
    relevantMemoriesRef.current = [];
    episodicBlockRef.current = "";
    setRecalledMemories([]);
    recalledDetailsRef.current = [];
    setRecalledDetails([]);
    knowledgeBlockRef.current = "";
setKnowledgeSummary([]);
    setEpisodeSummary([]);
    lastPayloadRef.current = null;
    setActiveProjectId(
      id ? (conversationsRef.current.find((c) => c.id === id)?.project_id ?? null) : null,
    );
    if (!id) {
      setMessages([]);
      setMessageVersions({});
      setTodos([]);
      return;
    }
    let rows = await db.listMessages(id);
    if (convIdRef.current !== id) return;
    const assistantId = assistantMsgIdRef.current;
    if (streamConversationIdRef.current === id && assistantId) {
      rows = db.withLiveTurn(rows, {
        assistantId,
        content: bufferRef.current,
        reasoning: reasoningRef.current,
        thinkingMs: thinkingMsRef.current,
        finishReason: finishRef.current,
        toolLog: toolLogRef.current,
        artifacts: artifactsRef.current,
        error: streamErrorRef.current,
      });
    }
    setMessages(rows);
    setMessageVersions(
      versionMap(rows, await db.listMessageTree(id)),
    );
    setTodos(await db.listTodos(id));
  }, [discardTemporary, leaveConversation]);

  const newConversation = useCallback(async () => {
    const previousId = convIdRef.current;
    leaveConversation(previousId);
    await discardTemporary();
    setActiveConversationId(null);
    setActiveProjectId(null);
    setMessages([]);
    setMessageVersions({});
    setTodos([]);
    setError(null);
    setView("chat");
    recallRequestRef.current += 1;
    knowledgeRequestRef.current += 1;
    episodeRequestRef.current += 1;
    relevantMemoriesRef.current = [];
    episodicBlockRef.current = "";
    setRecalledMemories([]);
    recalledDetailsRef.current = [];
    setRecalledDetails([]);
    knowledgeBlockRef.current = "";
setKnowledgeSummary([]);
    setEpisodeSummary([]);
    lastPayloadRef.current = null;
  }, [discardTemporary, leaveConversation]);

  const newTemporaryChat = useCallback(async () => {
    const connection = connRef.current;
    if (!connection || !modelRef.current) {
      setError("Add a connection and model first.");
      return;
    }
    leaveConversation(convIdRef.current);
    await discardTemporary();
    try {
      const created = await db.createConversation(connection.id, modelRef.current, null, true);
      await db.touchConversation(created.id, { title: "Temporary chat" });
      const titled = { ...created, title: "Temporary chat" };
      conversationsRef.current = [titled, ...conversationsRef.current];
      setConversations((prev) => [titled, ...prev]);
      setActiveConversationId(created.id);
      setActiveProjectId(null);
      setMessages([]);
      setMessageVersions({});
      setTodos([]);
      setError(null);
      setView("chat");
      recallRequestRef.current += 1;
      knowledgeRequestRef.current += 1;
      episodeRequestRef.current += 1;
      relevantMemoriesRef.current = [];
      episodicBlockRef.current = "";
      setRecalledMemories([]);
      recalledDetailsRef.current = [];
      setRecalledDetails([]);
      knowledgeBlockRef.current = "";
      setKnowledgeSummary([]);
      setEpisodeSummary([]);
      lastPayloadRef.current = null;
    } catch (e) {
      reportError(e);
    }
  }, [discardTemporary, leaveConversation, reportError]);

  const refreshTodos = useCallback(async (conversationId: string | null) => {
    if (!conversationId) {
      setTodos([]);
      return;
    }
    const rows = await db.listTodos(conversationId);
    if (convIdRef.current === conversationId) setTodos(rows);
  }, []);

  const removeConversation = useCallback(
    async (id: string) => {
      if (streamConversationId === id) {
        toast("Stop the working turn before deleting this chat.");
        return;
      }
      await db.deleteConversation(id);
      await api.deleteSpill(id).catch(() => {
        toast("Spill files may remain on disk");
      });
      setConversations(await db.listConversations());
      if (activeConversationId === id) {
        setActiveConversationId(null);
        setMessages([]);
        relevantMemoriesRef.current = [];
        recalledDetailsRef.current = [];
        setRecalledMemories([]);
        setRecalledDetails([]);
        knowledgeBlockRef.current = "";
        knowledgeBlockRef.current = "";
setKnowledgeSummary([]);
        episodicBlockRef.current = "";
        setEpisodeSummary([]);
      }
    },
    [activeConversationId, streamConversationId],
  );

  const renameConversation = useCallback(async (id: string, title: string) => {
    const trimmed = title.trim();
    if (!trimmed) return;
    await db.touchConversation(id, { title: trimmed });
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, title: trimmed } : c)));
  }, []);

  const setChatPrompt = useCallback(async (id: string, prompt: string | null) => {
    const trimmed = prompt?.trim() ?? "";
    const value = trimmed ? trimmed : null;
    await db.touchConversation(id, { system_prompt: value });
    setConversations((prev) =>
      prev.map((c) => (c.id === id ? { ...c, system_prompt: value } : c)),
    );
    chatPromptRef.current = value;
  }, []);

  const togglePin = useCallback(async (id: string) => {
    await db.toggleConversationPin(id);
    setConversations(await db.listConversations());
  }, []);

  const moveConversation = useCallback(async (id: string, projectId: string | null) => {
    await db.touchConversation(id, { project_id: projectId });
    setConversations(await db.listConversations());
    if (convIdRef.current === id) {
      const moved = (projectRef.current?.id ?? null) !== projectId;
      setActiveProjectId(projectId);
      recallRequestRef.current += 1;
    knowledgeRequestRef.current += 1;
      episodeRequestRef.current += 1;
      relevantMemoriesRef.current = [];
      episodicBlockRef.current = "";
      setRecalledMemories([]);
      recalledDetailsRef.current = [];
      setRecalledDetails([]);
      knowledgeBlockRef.current = "";
setKnowledgeSummary([]);
      setEpisodeSummary([]);
      lastPayloadRef.current = null;
      if (moved) {
        projectMemoriesRef.current = [];
        projectSentRef.current = null;
        sentOrderRef.current = null;
        setProjectMemories([]);
      }
    }
  }, []);

  const finalize = useCallback(async (
    assistantId: string,
    conversationId: string,
    endedAt?: number,
  ): Promise<void> => {
    setActiveStep(null);
    setTurnStartedAt(null);
    setActiveTool(null);
    const content = bufferRef.current;
    const reasoning = reasoningRef.current;
    const error = streamErrorRef.current;
    const startedAt = turnStartRef.current;
    const priorDuration = priorDurationRef.current;
    turnStartRef.current = null;
    priorDurationRef.current = 0;
    const completedAt = startedAt === null ? null : (endedAt ?? Date.now());
    const durationMs =
      startedAt === null || completedAt === null
        ? null
        : Math.max(0, completedAt - startedAt) + priorDuration;
    const settledLog = settleToolLog(toolLogRef.current);
    const changed = settledLog.some((entry, index) => entry !== toolLogRef.current[index]);
    toolLogRef.current = settledLog;
    const toolLogJson = settledLog.length > 0 ? JSON.stringify(settledLog) : null;
    const artifactsJson =
      artifactsRef.current.length > 0 ? JSON.stringify(artifactsRef.current) : null;
    if (!content && !reasoning && !toolLogJson && !artifactsJson && !error) {
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
    } else if (changed) {
      setMessages((prev) =>
        prev.map((m) => (m.id === assistantId ? { ...m, ...toolLogPatch(settledLog) } : m)),
      );
    }
    const usage = usageRef.current;
    const meta = {
      reasoning: reasoning || null,
      thinkingMs: thinkingMsRef.current,
      promptTokens: usage?.prompt ?? null,
      completionTokens: usage?.completion ?? null,
      totalTokens: usage?.total ?? null,
      finishReason: finishRef.current,
      toolLogJson,
      artifactsJson,
      error: error ?? null,
      durationMs,
      completedAt,
    };
    if (durationMs !== null) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId
            ? { ...m, duration_ms: durationMs, completed_at: completedAt }
            : m,
        ),
      );
    }
    const persist = content || toolLogJson || artifactsJson || error
      ? db.updateMessage(assistantId, content).then(() => db.updateMessageMeta(assistantId, meta))
      : db.deleteMessage(assistantId);
    try {
      await persist;
      await db.touchConversation(conversationId, {});
    } catch (error) {
      reportError(error);
    }
  }, []);

  const systemPromptFromRefs = useCallback(() => {
    const durableMemories = memoryPausedRef.current
      ? []
      : orderedSentMemories(
          globalMemoriesRef.current,
          projectMemoriesRef.current,
          sentOrderRef.current,
        );
    const base = buildSystemPrompt({
      globalMemories: durableMemories,
      project: projectRef.current,
      projectMemories: [],
      relevantMemories: memoryPausedRef.current ? [] : relevantMemoriesRef.current,
      episodicBlock: episodicRecallRef.current
        ? episodicBlockRef.current || undefined
        : undefined,
      userName: displayNameRef.current || undefined,
      standingPrompt: standingPromptRef.current || undefined,
      chatPrompt: chatPromptRef.current ?? undefined,
      knowledgeBlock: knowledgeBlockRef.current || undefined,
      skillIndexBlock: skillIndexRef.current || undefined,
      openuiPrompt: generativeUi ? OPENUI_SYSTEM_PROMPT : undefined,
      themePrompt: visualThemePrompt(readVisualTheme()),
      contextLimit: contextLimitRef.current,
      now: new Date(),
    });
    return base;
  }, [generativeUi]);

  const refreshSystemPrompt = useCallback(
    (payload: PayloadTurn[]): PayloadTurn[] => {
      const system = systemPromptFromRefs();
      if (!system) return payload;
      const rest = payload[0]?.role === "system" ? payload.slice(1) : payload;
      return [{ role: "system", content: system }, ...rest];
    },
    [systemPromptFromRefs],
  );

  const withSystem = useCallback(
    (turns: PayloadTurn[], summary: string | null = null) => {
      const system = systemPromptFromRefs();
      return [
        ...(system ? [{ role: "system", content: system }] : []),
        ...(summary ? [summarySystemTurn(summary)] : []),
        ...turns,
      ];
    },
    [systemPromptFromRefs],
  );

  const streamTurn = useCallback(
    async (
      conversationId: string,
      connection: Connection,
      modelName: string,
      payload: PayloadTurn[],
      assistantMsg: Message,
      keepSeed?: boolean,
    ): Promise<void> => {
      const requestId = newId();
      requestIdRef.current = requestId;
      lastPayloadRef.current = payload;
      setCanRetry(false);
      const startedAt = Date.now();
      setActiveStep(null);
      setTurnStartedAt(startedAt);
      turnStartRef.current = startedAt;
      const memoryIdsBefore = new Set(
        [...globalMemoriesRef.current, ...projectMemoriesRef.current].map(
          (memory) => memory.id,
        ),
      );
      const seed = keepSeed
        ? messagesRef.current.find((m) => m.id === assistantMsg.id)
        : undefined;
      priorDurationRef.current = seed?.duration_ms ?? 0;
      bufferRef.current = seed?.content ?? "";
      trimNextDeltaRef.current = false;
      reasoningRef.current = seed?.reasoning ?? "";
      thinkingStartRef.current = null;
      thinkingMsRef.current = null;
      usageRef.current = null;
      finishRef.current = null;
      streamErrorRef.current = null;
      setActiveTool(null);
      artifactsRef.current = db.parseDeclaredArtifacts(seed?.artifacts);
      assistantMsgIdRef.current = assistantMsg.id;
      setStreamingId(assistantMsg.id);
      setStreamConversationId(conversationId);
      streamConversationIdRef.current = conversationId;
      toolLogRef.current = keepSeed
        ? seedToolLog(db.parseToolLog(seed?.tool_log), assistantMsg.id)
        : [];
      if (!keepSeed) {
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMsg.id ? { ...m, tool_log: null } : m)),
        );
      }
      setApproval(null);
      setQuestion(null);
      let lastFlush = 0;
      const flush = () => {
        lastFlush = Date.now();
        const buffered = bufferRef.current;
        const reasoning = reasoningRef.current;
        const thinkingMs = thinkingMsRef.current;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantMsg.id
              ? {
                  ...m,
                  content: buffered,
                  reasoning,
                  thinking_ms: thinkingMs,
                  finish_reason: finishRef.current,
                }
              : m,
          ),
        );
      };

      const applyToolLog = (entries: ToolEntry[]) => {
        toolLogRef.current = entries;
        const patch = toolLogPatch(entries);
        setMessages((prev) => prev.map((m) => (m.id === assistantMsg.id ? { ...m, ...patch } : m)));
      };

      const hasImages = payload.some(
        (message) =>
          Array.isArray(message.content) &&
          message.content.some((part) => part.type === "image_url"),
      );
      const fallback = visionFallbackRef.current;
      pendingVisionFallbackRef.current = visionFallbackFor(
        hasImages,
        fallback,
        resolveTools(),
        canSeeImages(connection.id, modelName),
        connection.id,
        connections,
      );

      try {
        await api.chatStream(
          {
            requestId,
            connectionId: connection.id,
            model: modelName,
            messages: payload,
            enableTools: resolveTools(),
            projectId: projectRef.current?.id ?? null,
            conversationId,
            reasoningEffort: resolveEffort(),
            connectionKind: connection.kind,
            searchBackend,
            searchEndpoint,
            childSystem: buildChildSystemPrompt({
              userName: displayNameRef.current || undefined,
              project: projectRef.current,
              now: new Date(),
            }),
            ...fallbackFields(pendingVisionFallbackRef.current),
          },
          (event) => {
            if (requestIdRef.current !== requestId) return;
            if (event.type === "delta") {
              const piece = trimNextDeltaRef.current ? event.text.replace(/^\s+/, "") : event.text;
              trimNextDeltaRef.current = false;
              bufferRef.current += piece;
              if (Date.now() - lastFlush >= 80) flush();
            } else if (event.type === "reasoning") {
              if (thinkingStartRef.current === null) thinkingStartRef.current = Date.now();
              reasoningRef.current += event.text;
              if (Date.now() - lastFlush >= 80) flush();
            } else if (event.type === "retract") {
              const kept = Array.from(bufferRef.current).slice(
                0,
                Math.max(0, Array.from(bufferRef.current).length - event.chars),
              );
              bufferRef.current = kept.join("");
              flush();
            } else if (event.type === "usage") {
              usageRef.current = {
                prompt: event.prompt_tokens,
                completion: event.completion_tokens,
                total: event.total_tokens,
              };
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsg.id
                    ? {
                        ...m,
                        prompt_tokens: event.prompt_tokens,
                        completion_tokens: event.completion_tokens,
                        total_tokens: event.total_tokens,
                      }
                    : m,
                ),
              );
            } else if (event.type === "step") {
              setActiveStep({ step: event.step, max: event.max });
            } else if (event.type === "finish") {
              finishRef.current = event.reason;
              setActiveTool(null);
              if (thinkingStartRef.current !== null && thinkingMsRef.current === null) {
                thinkingMsRef.current = Date.now() - thinkingStartRef.current;
              }
            } else if (event.type === "retrying") {
              toast(`Retrying (${event.attempt}/${event.max})`);
            } else if (event.type === "tool_start") {
              if (bufferRef.current && !bufferRef.current.endsWith("\n\n")) {
                bufferRef.current += "\n\n";
                trimNextDeltaRef.current = true;
                flush();
              }
              const entry: ToolEntry = {
                id: event.id,
                name: event.name,
                summary: event.summary,
                status: "running",
                preview: null,
              };
              const index = toolLogRef.current.findIndex((item) => item.id === event.id);
              const next = [...toolLogRef.current];
              if (index === -1) next.push(entry);
              else next[index] = entry;
              applyToolLog(next);
              setActiveTool(event.name);
            } else if (event.type === "tool_result") {
              applyToolLog(
                toolLogRef.current.map((entry) =>
                  entry.id === event.id
                    ? {
                        ...entry,
                        status: event.ok ? ("ok" as const) : ("err" as const),
                        preview:
                          entry.name === "delegate_task" && entry.preview
                            ? `${entry.preview}\n\n--- summary ---\n${event.preview}`.slice(
                                0,
                                SUBAGENT_PREVIEW_LIMIT,
                              )
                            : event.preview,
                      }
                    : entry,
                ),
              );
              setActiveTool(null);
              const finished = toolLogRef.current.find((entry) => entry.id === event.id);
              if (
                finished &&
                (finished.name === "todo_write" || finished.name === "todo_set")
              ) {
                void refreshTodos(conversationId);
              }
            } else if (event.type === "tool_sources") {
              applyToolLog(
                toolLogRef.current.map((entry) =>
                  entry.id === event.id
                    ? {
                        ...entry,
                        domains: event.domains.length > 0 ? event.domains : entry.domains,
                        files: event.files.length > 0 ? event.files : entry.files,
                      }
                    : entry,
                ),
              );
            } else if (event.type === "subagent") {
              const next = subagentPreview(
                toolLogRef.current.find((entry) => entry.id === event.parent)?.preview ?? null,
                event.event,
              );
              applyToolLog(
                toolLogRef.current.map((entry) =>
                  entry.id === event.parent ? { ...entry, preview: next } : entry,
                ),
              );
            } else if (event.type === "artifact") {
              const index = artifactsRef.current.length;
              const declared: DeclaredArtifact = {
                title: event.title,
                lang: event.lang,
                code: event.code,
              };
              artifactsRef.current = [...artifactsRef.current, declared];
              const artifactsJson = JSON.stringify(artifactsRef.current);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsg.id ? { ...m, artifacts: artifactsJson } : m,
                ),
              );
              openArtifact({
                id: `${assistantMsg.id}:tool:${index}`,
                ...declared,
                messageId: assistantMsg.id,
                locator: { kind: "tool", index },
              });
              toast(`Artifact saved: ${event.title}`);
            } else if (event.type === "approval_asked") {
              if (conversationId !== convIdRef.current) {
                void selectConversation(conversationId);
              }
              setApproval({
                id: event.id,
                tool: event.tool,
                command: event.command,
                cwd: event.cwd,
                screen: event.screen ?? null,
                screenFailed: event.screen_failed,
              });
            } else if (event.type === "question_asked") {
              if (conversationId !== convIdRef.current) {
                void selectConversation(conversationId);
              }
              setQuestion({
                id: event.id,
                question: event.question,
                options: event.options,
                allowCustom: event.allow_custom,
              });
            }
          },
        );
        await refreshTodos(conversationId);
        if (toolLogRef.current.some((entry) => MEMORY_WRITE_TOOLS.has(entry.name))) {
          const waiting = pendingMemoriesRef.current.length;
          const [read, rows] = await Promise.all([
            refreshMemories(),
            refreshPendingMemories(),
          ]);
          const added = rows.length - waiting;
          if (added > 0) {
            toast(`${added} ${added === 1 ? "memory is" : "memories are"} waiting for review`, {
              actions: [{ label: "Review", run: () => setSettingsPage("memory") }],
            });
          } else {
            const saved = [...read.global, ...read.project]
              .filter((memory) => !memoryIdsBefore.has(memory.id))
              .sort((a, b) => b.created_at - a.created_at)[0];
            if (saved) {
              toast("Memory saved", {
                actions: [
                  {
                    label: "Undo",
                    run: () => {
                      void deleteMemory(saved.id, saved.scope, saved.project_id).catch(
                        reportError,
                      );
                    },
                  },
                ],
              });
            }
          }
        }
      } catch (e) {
        if (requestIdRef.current === requestId) {
          const message = api.formatInvokeError(e);
          streamErrorRef.current = message;
          finishRef.current = "error";
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsg.id ? { ...m, error: message, finish_reason: "error" } : m,
            ),
          );
          setCanRetry(lastPayloadRef.current !== null);
          console.warn("stream failed", e);
        }
      } finally {
        if (requestIdRef.current === requestId) {
          const endedAt = Date.now();
          if (thinkingStartRef.current !== null && thinkingMsRef.current === null) {
            thinkingMsRef.current = Date.now() - thinkingStartRef.current;
          }
          setApproval(null);
          setQuestion(null);
          flush();
          try {
            const complete = finishRef.current === "stop";
            await api.todoFinish(conversationId, complete);
            await refreshTodos(conversationId);
          } catch (e) {
            reportError(e);
          }
          requestIdRef.current = null;
          assistantMsgIdRef.current = null;
          pendingVisionFallbackRef.current = null;
          await finalize(assistantMsg.id, conversationId, endedAt);
          if (streamConversationIdRef.current === conversationId) {
            streamConversationIdRef.current = null;
            setStreamingId(null);
            setStreamConversationId(null);
          }
          if (artifactsRef.current.length > 0) {
            setArtifactVersionRevision((revision) => revision + 1);
          }
          if (rollupAfterStreamRef.current.delete(conversationId)) {
            const projectId = conversationsRef.current.find(
              (conversation) => conversation.id === conversationId,
            )?.project_id;
            if (projectId) void rollupConversation(conversationId, projectId, "close");
          }
          const title =
            conversationsRef.current.find((conversation) => conversation.id === conversationId)
              ?.title ?? "Reply ready";
          void notifyTurnDone(title, bufferRef.current).catch((error: unknown) => {
            console.warn("completion notification failed", error);
          });
        }
      }
    },
    [
      canSeeImages,
      connections,
      finalize,
      openArtifact,
      resolveEffort,
      resolveTools,
      refreshTodos,
      refreshMemories,
      refreshPendingMemories,
      deleteMemory,
      rollupConversation,
      selectConversation,
      searchBackend,
      searchEndpoint,
    ],
  );

  const maybeGenerateTitle = useCallback(
    async (
      conversationId: string,
      provisionalTitle: string,
      userText: string,
      assistantText: string,
    ) => {
      const connection = connRef.current;
      if (!connection || !modelRef.current || !assistantText.trim()) return;
      if (conversationsRef.current.find((c) => c.id === conversationId)?.temporary) return;
      const candidates = [modelRef.current];
      const fallback = connection.default_model;
      if (fallback && fallback !== modelRef.current) candidates.push(fallback);
      let trimmed = "";
      for (const candidate of candidates) {
        try {
          const title = await api.suggestTitle(
            connection.id,
            candidate,
            userText,
            assistantText,
            connection.kind,
          );
          trimmed = plainTitle(title);
          if (trimmed) break;
        } catch (cause) {
          console.warn("title generation failed", cause);
        }
      }
      if (!trimmed) {
        toast("Couldn't generate a title for this chat.");
        return;
      }
      const fresh = (await db.listConversations()).find((c) => c.id === conversationId);
      if (!fresh || fresh.title !== provisionalTitle) {
        return;
      }
      await db.touchConversation(conversationId, { title: trimmed });
      setConversations((prev) =>
        prev.map((c) => (c.id === conversationId ? { ...c, title: trimmed } : c)),
      );
    },
    [],
  );

  const summaryFor = useCallback((conversationId: string | null) => {
    const conversation = conversationId
      ? conversationsRef.current.find((c) => c.id === conversationId)
      : undefined;
    return {
      summary: conversation?.summary ?? null,
      through: conversation?.summary_through ?? null,
    };
  }, []);

  const resolveCompact = useCallback(
    (conversationId: string | null, turns: PayloadTurn[]) => {
      const conversation = conversationId
        ? conversationsRef.current.find((c) => c.id === conversationId)
        : undefined;
      if (conversation?.compacted === 1) return true;
      const system = systemPromptFromRefs();
      if (estimateContext(turns, system, contextLimitRef.current).pct > 80) {
        toast("Context is over 80% full - sending recent messages only.");
        return true;
      }
      return false;
    },
    [systemPromptFromRefs],
  );

  const setCompacted = useCallback(async (id: string, value: boolean) => {
    try {
      await db.setConversationCompacted(id, value);
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, compacted: value ? 1 : 0 } : c)),
      );
    } catch (e) {
      reportError(e);
    }
  }, []);

  const compactActive = useCallback(
    async (quiet = false) => {
      const id = convIdRef.current;
      const connection = connRef.current;
      const model = modelRef.current;
      if (!id || !connection || !model || streamConversationId !== null) {
        if (!quiet) toast("Nothing to compact yet");
        return;
      }
      const all = messagesRef.current.filter((m) => m.content.length > 0);
      const KEEP = 8;
      if (all.length <= KEEP) {
        if (!quiet) toast("Nothing to compact yet");
        return;
      }
      const older = all.slice(0, -KEEP);
      const prior = conversationsRef.current.find((c) => c.id === id)?.summary;
      const text = [
        ...(prior ? [`Previous summary:\n${prior}`] : []),
        ...older.map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`),
      ].join("\n\n");
      setCompacting(true);
      try {
        const summary = await api.summarize(
          connection.id,
          model,
          text,
          connection.kind,
        );
        const through = older[older.length - 1].created_at;
        await db.setConversationSummary(id, summary, through);
        await db.setConversationCompacted(id, true);
        setConversations((prev) =>
          prev.map((c) =>
            c.id === id ? { ...c, compacted: 1, summary, summary_through: through } : c,
          ),
        );
        if (!quiet) toast("Context compacted");
      } catch (e) {
        reportError(e);
      } finally {
        setCompacting(false);
      }
    },
    [streamConversationId],
  );

  const maybeAutoCompact = useCallback(
    async (conversationId: string) => {
      if (!autoCompactRef.current) return;
      if (convIdRef.current !== conversationId) return;
      const { summary, through } = summaryFor(conversationId);
      const turns = messagesRef.current.filter((m) => m.content.length > 0);
      const fresh = through !== null ? turns.filter((m) => m.created_at > through) : turns;
      if (fresh.length === 0) return;
      const system = systemPromptFromRefs();
      const windowed = summary
        ? applySummaryWindow(turns, { summary, through })
        : applyCompactWindow(turns, false);
      const tokens =
        usageRef.current?.total ??
        estimateContext(windowed, system, contextLimitRef.current).tokens;
      const ratio = tokens / contextLimitRef.current;
      if (ratio < 0.7) {
        autoLatchRef.current = null;
        return;
      }
      if (ratio <= 0.8) return;
      const latch = autoLatchRef.current;
      if (latch && latch.through === through && latch.count === turns.length) return;
      toast("Context over 80% full - compacting");
      await compactActive(true);
      autoLatchRef.current = {
        through: summaryFor(conversationId).through,
        count: messagesRef.current.length,
      };
    },
    [compactActive, summaryFor, systemPromptFromRefs],
  );

  const uncompactActive = useCallback(async () => {
    const id = convIdRef.current;
    if (!id) return;
    try {
      await db.setConversationSummary(id, null, null);
      await setCompacted(id, false);
      setConversations((prev) =>
        prev.map((c) => (c.id === id ? { ...c, summary: null, summary_through: null } : c)),
      );
    } catch (e) {
      reportError(e);
    }
  }, [setCompacted]);

  const buildPayload = useCallback(
    (conversationId: string | null, turns: (PayloadTurn & { attachments?: string | null; created_at?: number })[]) => {
      const { summary, through } = summaryFor(conversationId);
      const windowed = summary
        ? applySummaryWindow(turns, { summary, through })
        : applyCompactWindow(turns, resolveCompact(conversationId, turns));
      const activeModelSees =
        canSeeImages(connRef.current?.id ?? null, modelRef.current) ||
        (knownVisionFallback(visionFallbackRef.current, connections) !== null && resolveTools());
      const shaped = activeModelSees ? withFinalTurnImages(windowed) : windowed;
      const deepseek =
        connRef.current?.kind === "deepseek" || /deepseek/i.test(modelRef.current ?? "");
      const slim: PayloadTurn[] = shaped.map((turn) => ({
        role: turn.role,
        content: turn.content,
        ...(turn.role === "assistant" && deepseek ? { reasoning: turn.reasoning ?? "" } : {}),
      }));
      return withSystem(slim, summary);
    },
    [canSeeImages, connections, resolveCompact, resolveTools, summaryFor, withSystem],
  );

  const inspectContext = useCallback(async (): Promise<api.RequestInspection> => {
    const connection = connRef.current;
    const modelName = modelRef.current;
    if (!connection || !modelName) throw new Error("Choose a provider and model first");
    const conversationId = convIdRef.current;
    const payload = buildPayload(
      conversationId,
      messagesRef.current.filter((message) => message.content.length > 0),
    );
    const hasImages = payload.some(
      (message) =>
        Array.isArray(message.content) &&
        message.content.some((part) => part.type === "image_url"),
    );
    const fallback = visionFallbackFor(
      hasImages,
      visionFallbackRef.current,
      resolveTools(),
      canSeeImages(connection.id, modelName),
      connection.id,
      connections,
    );
    return api.inspectRequest({
      requestId: "context-inspector",
      connectionId: connection.id,
      model: modelName,
      messages: payload,
      enableTools: resolveTools(),
      projectId: projectRef.current?.id ?? null,
      conversationId,
      reasoningEffort: resolveEffort(),
      connectionKind: connection.kind,
      searchBackend,
      searchEndpoint,
      childSystem: buildChildSystemPrompt({
        userName: displayNameRef.current || undefined,
        project: projectRef.current,
        now: new Date(),
      }),
      ...fallbackFields(fallback),
    });
  }, [buildPayload, canSeeImages, connections, resolveEffort, resolveTools, searchBackend, searchEndpoint]);

  const sendMessage = useCallback(
    async (
      text: string,
      images?: { dataUrl: string }[],
      docs?: ChatDocument[],
    ): Promise<boolean> => {
      if (streamConversationId !== null) {
        toast("Another chat is still working. Wait for it, or open that chat to stop it.");
        return false;
      }
      const connection = connRef.current;
      if (!connection) {
        setError("Add a connection in Settings first.");
        return false;
      }
      if (!modelRef.current) {
        setError("Select a model first.");
        return false;
      }
      if (!KEYLESS_KINDS.has(connection.kind)) {
        let hasKey = false;
        try {
          hasKey = await api.hasApiKey(connection.id);
        } catch (e) {
          setError(`Couldn't read the saved key for ${connection.name}: ${errorText(e)}`);
          return false;
        }
        if (!hasKey) {
          setError(`Add an API key for ${connection.name} in Settings → Providers before sending.`);
          return false;
        }
      }

      setError(null);
      const history = messages.filter((m) => m.content.length > 0);

      let conversationId = convIdRef.current;
      let turnProjectId = conversationId
        ? (conversationsRef.current.find((item) => item.id === conversationId)?.project_id ?? null)
        : (projectRef.current?.id ?? null);
      let userMsg: Message;
      let assistantMsg: Message;
      let provisionalTitle: string | null = null;
      try {
        if (!conversationId) {
          const created = await db.createConversation(
            connection.id,
            modelRef.current,
            projectRef.current?.id ?? null,
          );
          conversationId = created.id;
          turnProjectId = created.project_id;
          conversationsRef.current = [created, ...conversationsRef.current];
          setConversations((prev) => [created, ...prev]);
          setActiveConversationId(created.id);
          setMessages([]);
          setTodos([]);
        }

        userMsg = await db.addMessage(
          conversationId,
          "user",
          text,
          null,
          history[history.length - 1]?.id ?? null,
        );
        assistantMsg = await db.addMessage(
          conversationId,
          "assistant",
          "",
          modelRef.current,
          userMsg.id,
        );
        setMessages((prev) => [...prev, userMsg, assistantMsg]);

        const current = conversations.find((c) => c.id === conversationId);
        if (!current || current.title === "New chat") {
          provisionalTitle = deriveFallbackTitle(text);
          await db.touchConversation(conversationId, {
            title: provisionalTitle,
            model: modelRef.current,
          });
          setConversations((prev) =>
            prev.map((c) =>
              c.id === conversationId
                ? { ...c, title: provisionalTitle as string, model: modelRef.current }
                : c,
            ),
          );
        } else {
          await db.touchConversation(conversationId, { model: modelRef.current });
          setConversations((prev) =>
            prev.map((c) =>
              c.id === conversationId ? { ...c, model: modelRef.current } : c,
            ),
          );
        }
      } catch (e) {
        reportError(e);
        return false;
      }

      const outgoing: PayloadTurn[] = [
        ...history,
      ];
      let skillBlock = "";
      let sendText = text;
      try {
        const index = await api.skillIndex().catch(() => []);
        skillBlock = buildSkillIndexBlock(index);
        const resolved = await resolveSkillMentions(text, index);
        if (resolved.unknown.length > 0) {
          toast(`Unknown skill: ${resolved.unknown.join(", ")}`);
        }
        sendText = resolved.content;
      } catch {
        skillBlock = "";
      }
      skillIndexRef.current = skillBlock;
      let knowledge = "";
      let knowledgeHits: api.KnowledgeHit[] = [];
      let knowledgeFresh = false;
      try {
        if (projectRef.current) {
          const request = knowledgeRequestRef.current;
          const found = await searchKnowledgeWithHits(
            projectRef.current.id,
            text,
            promptBudget(contextLimitRef.current).knowledge,
          );
          if (request === knowledgeRequestRef.current) {
            knowledge = found.block;
            knowledgeHits = found.hits;
            knowledgeFresh = true;
          }
        }
      } catch (error) {
        console.warn("knowledge: search failed for this turn", error);
        knowledge = "";
      }
      if (knowledgeFresh) {
        setKnowledgeSummary(knowledgeHits);
      }
      const vision = canSeeImages(connRef.current?.id ?? null, modelRef.current);
      const toolsOn = resolveTools();
      const fallback = knownVisionFallback(visionFallbackRef.current, connections);
      const imageCount = images?.length ?? 0;
      const routed = !vision && fallback !== null && toolsOn && imageCount > 0;
      const gated = resolveImageSend(vision || routed, images ?? []);
      const fit = fitImageBudget(gated.kept);
      if (gated.dropped) {
        toast(imageDropToast(fallback !== null));
      } else if (fit.dropped > 0) {
        toast(`${fit.dropped} image(s) dropped to fit the turn budget.`);
      } else if (routed) {
        toast("Reading images with the fallback vision model…");
      }
      if (gated.dropped || fit.dropped > 0) {
        knowledge = [knowledge, "[Some attached images were removed: no vision support or over budget.]"]
          .filter((part) => part.length > 0)
          .join("\n\n");
      }
      knowledgeBlockRef.current = knowledge;
      let imagesForPayload = fit.kept;
      if (fit.kept.length > 0) {
        try {
          const stamp = Date.now();
          await Promise.all(
            fit.kept.map((image, index) =>
              api.spillImageWrite(conversationId, `img-${stamp}-${index}`, image.dataUrl),
            ),
          );
        } catch (e) {
          reportError(e);
          if (routed) {
            toast("Couldn't hand images to the vision model — sending text only.");
            imagesForPayload = [];
          }
        }
      }
      let documents: ChatDocument[] = [];
      if ((docs?.length ?? 0) > 0) {
        const committed = await commitChatDocs(
          conversationId,
          docs ?? [],
          projectRef.current?.id ?? null,
        );
        documents = committed.committed;
        if (committed.failed.length > 0) {
          toast(`Could not attach: ${committed.failed.join(", ")}`);
        }
      }
      const attachments = [...documents.map(toAttachment), ...imagesForPayload];
      if (attachments.length > 0) {
        try {
          await db.updateMessageAttachments(userMsg.id, attachments);
          const stored = JSON.stringify(attachments);
          setMessages((prev) =>
            prev.map((m) => (m.id === userMsg.id ? { ...m, attachments: stored } : m)),
          );
        } catch (e) {
          reportError(e);
        }
      }
      const documentBlock = await buildDocumentBlock(
        documents,
        projectRef.current?.id ?? null,
      );
      const userContent = prependDocumentBlock(
        imagesForPayload.length > 0 ? buildUserContent(sendText, imagesForPayload) : sendText,
        documentBlock,
      );
      const recalled = await recallFor(sendText, projectRef.current?.id ?? null);
      const episodes = await recallEpisodes(
        sendText,
        projectRef.current?.id ?? null,
        convIdRef.current,
      );
      auditTurn(conversationId, sendText, recalled, knowledgeHits, episodes);
      outgoing.push({ role: "user", content: userContent });
      const payload = buildPayload(conversationId, outgoing);

      await streamTurn(conversationId, connection, modelRef.current, payload, assistantMsg);
      if (provisionalTitle) {
        void maybeGenerateTitle(conversationId, provisionalTitle, text, bufferRef.current);
      }
      await maybeAutoCompact(conversationId);
      scheduleTurnRollup(
        conversationId,
        turnProjectId,
        outgoing.filter((turn) => turn.role === "user").length,
        sendText,
      );
      return true;
    },
    [
      canSeeImages,
      connections,
      conversations,
      finalize,
      messages,
      recallFor,
      recallEpisodes,
      streamConversationId,
      streamTurn,
      buildPayload,
      resolveTools,
      maybeGenerateTitle,
      maybeAutoCompact,
      scheduleTurnRollup,
    ],
  );

  const refreshVersions = useCallback(
    async (conversationId: string, path: Message[]) => {
      try {
        const tree = await db.listMessageTree(conversationId);
        setMessageVersions(versionMap(path, tree));
      } catch (error) {
        reportError(error);
      }
    },
    [reportError],
  );

  const regenerate = useCallback(async () => {
    const conversationId = convIdRef.current;
    const connection = connRef.current;
    if (!conversationId || !connection || !modelRef.current || streamConversationId !== null) return;
    const turns = messagesRef.current.filter((m) => m.content.length > 0);
    if (turns.length === 0 || turns[turns.length - 1].role !== "assistant") return;
    const dropped = turns[turns.length - 1];
    const kept = turns.slice(0, -1);
    let assistantMsg: Message;
    try {
      assistantMsg = await db.addMessage(
        conversationId,
        "assistant",
        "",
        modelRef.current,
        dropped.parent_id ?? null,
      );
    } catch (e) {
      reportError(e);
      return;
    }
    setMessages([...kept, assistantMsg]);
    void refreshVersions(conversationId, [...kept, assistantMsg]);
    const lastUser = [...kept].reverse().find((message) => message.role === "user");
    auditTurn(
      conversationId,
      lastUser?.content ?? "",
      relevantMemoriesRef.current,
      knowledgeSummaryRef.current,
      episodeSummaryRef.current,
    );
    await streamTurn(
      conversationId,
      connection,
      modelRef.current,
      buildPayload(conversationId, await withDocumentBlock(kept, projectRef.current?.id ?? null)),
      assistantMsg,
    );
  }, [auditTurn, refreshVersions, streamConversationId, streamTurn, buildPayload]);

  const continueTurn = useCallback(async () => {
    const conversationId = convIdRef.current;
    const connection = connRef.current;
    if (!conversationId || !connection || !modelRef.current || streamConversationId !== null) return;
    const turns = messagesRef.current.filter((m) => m.content.length > 0);
    if (turns.length === 0 || turns[turns.length - 1].role !== "assistant") return;
    const partial = turns[turns.length - 1];
    if (partial.finish_reason === "step_limit" || partial.finish_reason === "time_limit") {
      const digest = db.continueDigest(db.parseToolLog(partial.tool_log));
      await sendMessage(
        `Continue from where you left off. Do not repeat work that is already done.${digest}`,
      );
      return;
    }
    if (partial.finish_reason !== "length" && partial.finish_reason !== "interrupted") return;
    const payload = lastPayloadRef.current
      ? refreshSystemPrompt(lastPayloadRef.current)
      : buildPayload(conversationId, await withDocumentBlock(turns, projectRef.current?.id ?? null));
    await streamTurn(
      conversationId,
      connection,
      modelRef.current,
      payload,
      partial,
      true,
    );
  }, [streamConversationId, streamTurn, buildPayload, sendMessage, refreshSystemPrompt]);

  const retryTurn = useCallback(async () => {
    const conversationId = convIdRef.current;
    const connection = connRef.current;
    const payload = lastPayloadRef.current ? refreshSystemPrompt(lastPayloadRef.current) : null;
    if (!conversationId || !connection || !modelRef.current || streamConversationId !== null || !payload) return;
    setError(null);
    let assistantMsg: Message;
    try {
      assistantMsg = await db.addMessage(
        conversationId,
        "assistant",
        "",
        modelRef.current,
        messagesRef.current[messagesRef.current.length - 1]?.id ?? null,
      );
    } catch (e) {
      reportError(e);
      return;
    }
    setMessages((prev) => [...prev, assistantMsg]);
    await streamTurn(conversationId, connection, modelRef.current, payload, assistantMsg);
  }, [streamConversationId, streamTurn, refreshSystemPrompt]);

  const replyApproval = useCallback(
    async (reply: "once" | "always" | "deny") => {
      if (!approval) return;
      setApproval(null);
      try {
        await api.approvalReply(approval.id, reply);
      } catch (e) {
        reportError(e);
      }
    },
    [approval],
  );

  const answerQuestion = useCallback(
    async (answer: string) => {
      if (!question) return;
      const trimmed = answer.trim();
      if (!trimmed) return;
      setQuestion(null);
      try {
        await api.questionAnswer(question.id, trimmed);
      } catch (e) {
        reportError(e);
      }
    },
    [question],
  );

  const editAndResubmit = useCallback(
    async (userId: string, text: string): Promise<boolean> => {
      const conversationId = convIdRef.current;
      const connection = connRef.current;
      if (!conversationId || !connection || !modelRef.current || streamConversationId !== null) return false;
      const trimmed = text.trim();
      if (!trimmed) return false;
      const current = messagesRef.current;
      const projectId =
        conversationsRef.current.find((conversation) => conversation.id === conversationId)
          ?.project_id ?? null;
      const at = current.findIndex((message) => message.id === userId);
      if (at < 0) return false;
      const edited = current[at];
      const kept = current.slice(0, at).filter((message) => message.content.length > 0);
      let userMsg: Message;
      let assistantMsg: Message;
      try {
        userMsg = await db.addMessage(
          conversationId,
          "user",
          trimmed,
          null,
          edited.parent_id ?? null,
        );
        if (edited.attachments) {
          await db.copyMessageAttachments(edited.id, userMsg.id);
          userMsg.attachments = edited.attachments;
        }
        assistantMsg = await db.addMessage(
          conversationId,
          "assistant",
          "",
          modelRef.current,
          userMsg.id,
        );
      } catch (e) {
        reportError(e);
        return false;
      }
      const nextPath = [...kept, userMsg, assistantMsg];
      setMessages(nextPath);
      void refreshVersions(conversationId, nextPath);
      auditTurn(
        conversationId,
        trimmed,
        relevantMemoriesRef.current,
        knowledgeSummaryRef.current,
        episodeSummaryRef.current,
      );
      await streamTurn(
        conversationId,
        connection,
        modelRef.current,
        buildPayload(
          conversationId,
          await withDocumentBlock([...kept, userMsg], projectRef.current?.id ?? null),
        ),
        assistantMsg,
      );
      scheduleTurnRollup(
        conversationId,
        projectId,
        nextPath.filter((message) => message.role === "user").length,
        trimmed,
      );
      return true;
    },
    [
      auditTurn,
      refreshVersions,
      scheduleTurnRollup,
      streamConversationId,
      streamTurn,
      buildPayload,
    ],
  );

  const clearTurnContext = useCallback(() => {
    relevantMemoriesRef.current = [];
    recalledDetailsRef.current = [];
    setRecalledMemories([]);
    setRecalledDetails([]);
    knowledgeBlockRef.current = "";
    setKnowledgeSummary([]);
    episodicBlockRef.current = "";
    setEpisodeSummary([]);
    lastPayloadRef.current = null;
  }, []);

  const branchFrom = useCallback(
    async (messageId: string) => {
      const conversationId = convIdRef.current;
      if (!conversationId || streamConversationId !== null) return;
      const source = conversations.find((c) => c.id === conversationId);
      if (!source) return;
      try {
        const branched = await db.branchConversation(
          conversationId,
          messageId,
          `${source.title} (branch)`,
        );
        leaveConversation(conversationId);
        conversationsRef.current = [branched, ...conversationsRef.current];
        setConversations((prev) => [branched, ...prev]);
        setActiveConversationId(branched.id);
        await copyChatDocs(conversationId, branched.id);
        const rows = await db.listMessages(branched.id);
        setMessages(rows);
        setMessageVersions(versionMap(rows, await db.listMessageTree(branched.id)));
        clearTurnContext();
        toast("Branched into new chat");
      } catch (e) {
        reportError(e);
      }
    },
    [clearTurnContext, conversations, leaveConversation, streamConversationId],
  );

  const switchVersion = useCallback(
    async (messageId: string, direction: 1 | -1) => {
      const conversationId = convIdRef.current;
      if (!conversationId || streamConversationId !== null) return;
      try {
        const tree = await db.listMessageTree(conversationId);
        const target = tree.find((message) => message.id === messageId);
        if (!target) return;
        const siblings = siblingVersions(target, tree);
        if (siblings.length < 2) return;
        const at = siblings.findIndex((sibling) => sibling.id === messageId);
        const nextSibling = siblings[(at + direction + siblings.length) % siblings.length];
        const leaf = deepestLeaf(nextSibling.id, tree);
        await db.setCurrentLeaf(conversationId, leaf);
        if (convIdRef.current !== conversationId) return;
        const byId = new Map(tree.map((message) => [message.id, message]));
        const path = messagePath(leaf, byId);
        setMessages(path);
        setMessageVersions(versionMap(path, tree));
        clearTurnContext();
      } catch (e) {
        reportError(e);
      }
    },
    [clearTurnContext, streamConversationId],
  );

  const rateMessage = useCallback(
    async (messageId: string, rating: number | null) => {
      const current = messagesRef.current.find((m) => m.id === messageId)?.rating ?? null;
      const next = current === rating ? null : rating;
      try {
        await db.setMessageRating(messageId, next);
        setMessages((prev) => prev.map((m) => (m.id === messageId ? { ...m, rating: next } : m)));
      } catch (e) {
        reportError(e);
      }
    },
    [reportError],
  );

  const startProjectChat = useCallback(
    async (
      projectId: string,
      text: string,
      images?: { dataUrl: string }[],
      docs?: ChatDocument[],
    ): Promise<boolean> => {
      const connection = connRef.current;
      if (!connection || !modelRef.current || streamConversationId !== null) return false;
      if (!KEYLESS_KINDS.has(connection.kind)) {
        let hasKey = false;
        try {
          hasKey = await api.hasApiKey(connection.id);
        } catch (error) {
          setError(`Couldn't read the saved key for ${connection.name}: ${errorText(error)}`);
          return false;
        }
        if (!hasKey) {
          setError(`Add an API key for ${connection.name} in Settings → Providers before sending.`);
          return false;
        }
      }
      const trimmed = text.trim();
      if (!trimmed && (images?.length ?? 0) === 0 && (docs?.length ?? 0) === 0) {
        return false;
      }
      setError(null);
      const previousConversationId = convIdRef.current;
      const previousProject = projectRef.current;
      let createdId: string | null = null;
      let enteredChat = false;
      try {
        const created = await db.createConversation(connection.id, modelRef.current, projectId);
        createdId = created.id;
        let userMsg = await db.addMessage(created.id, "user", trimmed);
        const assistantMsg = await db.addMessage(
          created.id,
          "assistant",
          "",
          modelRef.current,
          userMsg.id,
        );
        const title = deriveFallbackTitle(trimmed);
        await db.touchConversation(created.id, { title });
        const titled = { ...created, title };
        conversationsRef.current = [titled, ...conversationsRef.current];
        setConversations((prev) => [titled, ...prev]);
        convIdRef.current = created.id;
        setActiveConversationId(created.id);
        setActiveProjectId(projectId);
        projectRef.current = projects.find((item) => item.id === projectId) ?? null;

        const vision = canSeeImages(connection.id, modelRef.current);
        const fallback = knownVisionFallback(visionFallbackRef.current, connections);
        const routed =
          !vision && fallback !== null && resolveTools() && (images?.length ?? 0) > 0;
        const gated = resolveImageSend(vision || routed, images ?? []);
        const fit = fitImageBudget(gated.kept);
        if (gated.dropped) {
          toast(imageDropToast(fallback !== null));
        } else if (fit.dropped > 0) {
          toast(`${fit.dropped} image(s) dropped to fit the turn budget.`);
        } else if (routed) {
          toast("Reading images with the fallback vision model…");
        }
        let imagesForPayload = fit.kept;
        if (imagesForPayload.length > 0) {
          try {
            const stamp = Date.now();
            await Promise.all(
              imagesForPayload.map((image, index) =>
                api.spillImageWrite(created.id, `img-${stamp}-${index}`, image.dataUrl),
              ),
            );
          } catch (error) {
            reportError(error);
            if (routed) {
              toast("Couldn't hand images to the vision model — sending text only.");
              imagesForPayload = [];
            }
          }
        }
        let documents: ChatDocument[] = [];
        if ((docs?.length ?? 0) > 0) {
          const committed = await commitChatDocs(created.id, docs ?? [], projectId);
          documents = committed.committed;
          if (committed.failed.length > 0) {
            toast(`Could not attach: ${committed.failed.join(", ")}`);
          }
        }
        const attachments = [...documents.map(toAttachment), ...imagesForPayload];
        if (attachments.length > 0) {
          await db.updateMessageAttachments(userMsg.id, attachments);
          userMsg = { ...userMsg, attachments: JSON.stringify(attachments) };
        }
        if (convIdRef.current !== created.id) {
          await db.deleteConversation(created.id).catch((cleanupError) => {
            console.warn("project chat: abandoned start cleanup failed", cleanupError);
          });
          await api.deleteSpill(created.id).catch(() => undefined);
          conversationsRef.current = conversationsRef.current.filter(
            (conversation) => conversation.id !== createdId,
          );
          setConversations((current) =>
            current.filter((conversation) => conversation.id !== createdId),
          );
          return false;
        }
        setMessages([userMsg, assistantMsg]);
        enteredChat = true;
        setView("chat");

        const documentBlock = await buildDocumentBlock(documents, projectId);
        const userContent = prependDocumentBlock(
          imagesForPayload.length > 0
            ? buildUserContent(trimmed, imagesForPayload)
            : trimmed,
          documentBlock,
        );
        const recalled = await recallFor(trimmed, projectId);
        const episodes = await recallEpisodes(trimmed, projectId, created.id);
        const found = await searchKnowledgeWithHits(
          projectId,
          trimmed,
          promptBudget(contextLimitRef.current).knowledge,
        ).catch((error) => {
          console.warn("knowledge: first-turn search failed", error);
          return { block: "", hits: [] as api.KnowledgeHit[] };
        });
        knowledgeBlockRef.current =
          gated.dropped || fit.dropped > 0
            ? [
                found.block,
                "[Some attached images were removed: no vision support or over budget.]",
              ]
                .filter(Boolean)
                .join("\n\n")
            : found.block;
        setKnowledgeSummary(found.hits);
        auditTurn(created.id, trimmed, recalled, found.hits, episodes);
        const firstTurns = [{ role: "user", content: userContent }];
        await streamTurn(
          created.id,
          connection,
          modelRef.current,
          buildPayload(created.id, firstTurns),
          assistantMsg,
        );
        void maybeGenerateTitle(created.id, title, trimmed, bufferRef.current);
        scheduleTurnRollup(created.id, projectId, 1, trimmed);
        return true;
      } catch (e) {
        if (createdId && !enteredChat) {
          const owned = convIdRef.current === createdId;
          await db.deleteConversation(createdId).catch((cleanupError) => {
            console.warn("project chat: rollback failed", cleanupError);
          });
          await api.deleteSpill(createdId).catch(() => undefined);
          conversationsRef.current = conversationsRef.current.filter(
            (conversation) => conversation.id !== createdId,
          );
          setConversations((current) =>
            current.filter((conversation) => conversation.id !== createdId),
          );
          if (owned && convIdRef.current === createdId) {
            convIdRef.current = previousConversationId;
            projectRef.current = previousProject;
            setActiveConversationId(previousConversationId);
            setActiveProjectId(previousProject?.id ?? null);
          }
        }
        reportError(e);
        return false;
      }
    },
    [
      projects,
      canSeeImages,
      connections,
      streamConversationId,
      streamTurn,
      buildPayload,
      resolveTools,
      maybeGenerateTitle,
      recallFor,
      recallEpisodes,
      scheduleTurnRollup,
    ],
  );

  const clearActiveConversation = useCallback(async () => {
    const id = convIdRef.current;
    if (!id) return;
    try {
      await db.clearConversation(id);
      await api.deleteSpill(id).catch(() => {
        toast("Spill files may remain on disk");
      });
      setMessages([]);
      await db.touchConversation(id, {});
      relevantMemoriesRef.current = [];
      recalledDetailsRef.current = [];
      setRecalledMemories([]);
      setRecalledDetails([]);
      knowledgeBlockRef.current = "";
      knowledgeBlockRef.current = "";
setKnowledgeSummary([]);
      episodicBlockRef.current = "";
      setEpisodeSummary([]);
      lastPayloadRef.current = null;
    } catch (e) {
      reportError(e);
    }
  }, []);

  const stopStream = useCallback(() => {
    const id = requestIdRef.current;
    if (!id) return;
    requestIdRef.current = null;
    setActiveTool(null);
    api.cancelStream(id).catch(reportError);
    const assistantId = assistantMsgIdRef.current;
    const conversationId = convIdRef.current;
    assistantMsgIdRef.current = null;
    if (conversationId) {
      void api
        .todoFinish(conversationId, false)
        .then(() => refreshTodos(conversationId))
        .catch(reportError);
    }
    if (assistantId && conversationId) {
      finishRef.current = "stopped";
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, finish_reason: "stopped" } : m,
        ),
      );
      void finalize(assistantId, conversationId).then(() => {
        if (streamConversationIdRef.current === conversationId) {
          streamConversationIdRef.current = null;
          setStreamingId(null);
          setStreamConversationId(null);
        }
        if (artifactsRef.current.length > 0) {
          setArtifactVersionRevision((revision) => revision + 1);
        }
        if (rollupAfterStreamRef.current.delete(conversationId)) {
          const projectId = conversationsRef.current.find(
            (conversation) => conversation.id === conversationId,
          )?.project_id;
          if (projectId) void rollupConversation(conversationId, projectId, "close");
        }
      });
    } else {
      streamConversationIdRef.current = null;
      setStreamingId(null);
      setStreamConversationId(null);
    }
  }, [finalize, refreshTodos, reportError, rollupConversation]);

  const value: AppContextValue = {
    ready,
    error,
    clearError: () => setError(null),
    canRetry,
    retryTurn,
    approval,
    replyApproval,
    question,
    answerQuestion,
    connections,
    activeConnection,
    activeConnectionId,
    selectConnection,
    refreshConnections,
    saveConnection,
    removeConnection,
    models,
    loadingModels,
    refreshModels,
    hiddenModels,
    catalog,
    toggleModelVisibility,
    setAllModelsVisibility,
    model,
    setModel,
    visionFallback,
    setVisionFallback,
    modelVisionOverride,
    setModelVisionOverride,
    canSeeImages,
    loadAllModelOptions,
    reasoningEffort,
    setReasoningEffort,
    supportedEfforts,
    modelContextLimit,
    contextInfo,
    inspectContext,
    projects,
    activeProject,
    activeProjectId,
    selectProject,
    view,
    setView,
    startProjectChat,
    saveProject,
    removeProject,
    refreshProjects,
    globalMemories,
    projectMemories,
    globalSentMemories,
    projectSentMemories,
    recalledMemories,
    recalledDetails,
    knowledgeSummary,
    episodeSummary,
    pendingMemories,
    memoryOmitted,
    memoryPaused,
    setMemoryPaused,
    episodicRecall,
    setEpisodicRecall,
    memoryCompat,
    memoryReport,
    dismissMemoryReport: () => setMemoryReport(null),
    refreshMemories,
    refreshPendingMemories,
    loadMemories,
    addMemory: saveMemoryToScope,
    queueMemories,
    editMemory,
    deleteMemory,
    approvePendingMemory,
    approveAllPendingMemories,
    dismissPendingMemory,
    undoApprovedMemory,
    conversations,
    activeConversationId,
    selectConversation,
    refreshConversations,
    newConversation,
    newTemporaryChat,
    removeConversation,
    renameConversation,
    setChatPrompt,
    togglePin,
    moveConversation,
    displayName,
    setDisplayName,
    standingPrompt,
    setStandingPrompt,
    showContextBar,
    setShowContextBar,
    chatPrompt:
      conversations.find((item) => item.id === activeConversationId)?.system_prompt ?? null,
    theme,
    setTheme,
    accent,
    setAccent,
    fontScale,
    setFontScale,
    density,
    setDensity,
    groupByDate,
    setGroupByDate,
    sidebarCollapsed,
    toggleSidebar,
    paletteOpen,
    setPaletteOpen,
    onboarded,
    completeOnboarding,
    settingsPage,
    setSettingsPage,
    messages,
    streaming,
    streamingId,
    workingConversationId,
    sendMessage,
    fileCommands,
    loadFileCommands,
    regenerate,
    continueTurn,
    editAndResubmit,
    branchFrom,
    messageVersions,
    switchVersion,
    rateMessage,
    clearActiveConversation,
    compactActive,
    uncompactActive,
    compacting,
    voicePhase,
    setVoicePhase,
    stopStream,
    composerDraft,
    setComposerDraft,
    composerSignal,
    setComposerText,
    sendWith,
    setSendWith,
    autoCompact,
    setAutoCompact,
    collapseThinking,
    setCollapseThinking,
    collapseToolCalls,
    setCollapseToolCalls,
    generativeUi,
    setGenerativeUi,
    searchBackend,
    setSearchBackend,
    searchEndpoint,
    setSearchEndpoint,
    todos,
    activeTool,
    activeStep,
    turnStartedAt,
    refreshTodos,
    panelOpen,
    panelArtifact,
    panelArtifactVersions,
    panelTab,
    panelMode,
    panelView,
    panelWidth,
    openArtifact,
    openSessionPanel,
    openContextPanel,
    showSessionView,
    closePanel,
    togglePanel,
    setPanelTab,
    setPanelMode,
    setPanelWidth,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
