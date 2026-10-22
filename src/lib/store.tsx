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
import { applyCompactWindow, applySummaryWindow, buildChildSystemPrompt, buildSystemPrompt, DEFAULT_MODEL_CONTEXT, estimateContext, summarySystemTurn } from "./context";
import { buildUserContent, resolveImageSend, searchKnowledge, withFinalTurnImages } from "./knowledge";
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
import {
  clampFontScale,
  parseDensity,
  parseFontScale,
  parseGroupByDate,
  type Density,
} from "./appearance";
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
import { newId } from "./utils";
import { deriveFallbackTitle } from "./title";
import type {
  Connection,
  ConnectionInput,
  Conversation,
  DeclaredArtifact,
  Memory,
  MemoryDraft,
  MemoryInput,
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
  return Math.min(720, Math.max(320, Math.round(width)));
}

export type ThemeMode = "system" | "light" | "dark";

type ToolEntry = ToolLogEntry;

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

type View = "chat" | "projects" | "project";

export type PanelTab = "preview" | "code" | "doc" | "source";
export type PanelMode = "dock" | "full" | "mini";

interface PanelArtifact {
  id: string;
  title: string;
  lang: string;
  code: string;
}

function defaultPanelTab(lang: string): PanelTab {
  const normalized = lang.toLowerCase();
  if (normalized === "html" || normalized === "htm") return "preview";
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
  refreshConnections: () => Promise<void>;
  saveConnection: (input: ConnectionInput, id?: string) => Promise<Connection>;
  removeConnection: (id: string) => Promise<void>;

  models: string[];
  loadingModels: boolean;
  refreshModels: () => Promise<void>;
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
  };

  projects: Project[];
  activeProject: Project | null;
  activeProjectId: string | null;
  selectProject: (id: string | null) => void;
  view: View;
  setView: (view: View) => void;
  startProjectChat: (projectId: string, text: string) => Promise<boolean>;
  saveProject: (input: ProjectInput, id?: string) => Promise<Project>;
  removeProject: (id: string) => Promise<void>;
  refreshProjects: () => Promise<void>;

  globalMemories: Memory[];
  projectMemories: Memory[];
  pendingMemories: PendingMemory[];
  refreshMemories: () => Promise<void>;
  refreshPendingMemories: () => Promise<PendingMemory[]>;
  loadMemories: (scope: MemoryScope, projectId: string | null) => Promise<Memory[]>;
  addMemory: (input: MemoryInput) => Promise<void>;
  editMemory: (id: string, draft: MemoryDraft) => Promise<void>;
  deleteMemory: (id: string) => Promise<void>;
  approvePendingMemory: (id: string) => Promise<void>;
  dismissPendingMemory: (id: string) => Promise<void>;
  undoApprovedMemory: (id: string) => Promise<void>;

  conversations: Conversation[];
  activeConversationId: string | null;
  refreshConversations: () => Promise<void>;
  selectConversation: (id: string | null) => Promise<void>;
  newConversation: () => Promise<void>;
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
  clearActiveConversation: () => Promise<void>;
  compactActive: (quiet?: boolean) => Promise<void>;
  uncompactActive: () => Promise<void>;
  compacting: boolean;
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
  searchBackend: "tavily" | "searxng";
  setSearchBackend: (value: "tavily" | "searxng") => void;
  searchEndpoint: string;
  setSearchEndpoint: (value: string) => void;
  todos: Todo[];
  refreshTodos: (conversationId: string | null) => Promise<void>;
  panelOpen: boolean;
  panelArtifact: PanelArtifact | null;
  panelTab: PanelTab;
  panelMode: PanelMode;
  panelWidth: number;
  openArtifact: (artifact: PanelArtifact) => void;
  closePanel: () => void;
  togglePanel: () => void;
  setPanelTab: (tab: PanelTab) => void;
  setPanelMode: (mode: PanelMode) => void;
  setPanelWidth: (width: number) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
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

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [fileCommands, setFileCommands] = useState<FileCommand[]>([]);
  const fileCommandsRef = useRef<FileCommand[]>([]);
  const [todos, setTodos] = useState<Todo[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [compacting, setCompacting] = useState(false);
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
  const autoCompactRef = useRef(true);
  const autoLatchRef = useRef<{ through: number | null; count: number } | null>(null);
  useEffect(() => {
    autoCompactRef.current = autoCompact;
  }, [autoCompact]);
  const globalMemoriesRef = useRef<Memory[]>([]);
  const projectMemoriesRef = useRef<Memory[]>([]);
  const pendingMemoriesRef = useRef<PendingMemory[]>([]);
  const requestIdRef = useRef<string | null>(null);
  const bufferRef = useRef("");
  const reasoningRef = useRef("");
  const thinkingStartRef = useRef<number | null>(null);
  const thinkingMsRef = useRef<number | null>(null);
  const usageRef = useRef<{ prompt: number; completion: number; total: number } | null>(null);
  const finishRef = useRef<string | null>(null);
  const assistantMsgIdRef = useRef<string | null>(null);

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

  const refreshConnections = useCallback(async () => {
    const rows = await db.listConnections();
    setConnections(rows);
    setActiveConnectionId((prev) =>
      prev && rows.some((row) => row.id === prev) ? prev : (rows[0]?.id ?? null),
    );
  }, []);

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
    const projectId = projectRef.current?.id ?? null;
    const [global, project] = await Promise.all([
      db.listMemories("global", null),
      projectId ? db.listMemories("project", projectId) : Promise.resolve<Memory[]>([]),
    ]);
    setGlobalMemories(global);
    setProjectMemories(project);
  }, []);

  const refreshPendingMemories = useCallback(async () => {
    const rows = await db.listPendingMemories();
    setPendingMemories(rows);
    return rows;
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await refreshConnections();
        await refreshProjects();
        await refreshMemories();
        await refreshPendingMemories();
        setConversations(await db.listConversations());
      } catch (e) {
        reportError(e);
      } finally {
        setReady(true);
      }
    })();
  }, [refreshConnections, refreshProjects, refreshMemories, refreshPendingMemories]);

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
      if (dark) {
        document.documentElement.setAttribute("data-theme", "dark");
      } else {
        document.documentElement.removeAttribute("data-theme");
      }
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

  const [accent, setAccentState] = useState(() => localStorage.getItem("accent") ?? "#c96442");
  const setAccent = useCallback((value: string) => {
    setAccentState(value);
    localStorage.setItem("accent", value);
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("--accent", accent);
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
  const [panelTab, setPanelTabState] = useState<PanelTab>("code");
  const [panelMode, setPanelModeState] = useState<PanelMode>("dock");
  const [panelWidth, setPanelWidthState] = useState(() => {
    const saved = Number(localStorage.getItem(PANEL_WIDTH_KEY));
    return clampPanelWidth(Number.isFinite(saved) && saved > 0 ? saved : 420);
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
    if (!panelOpenRef.current) setPanelModeState("dock");
    setPanelArtifact(artifact);
    setPanelTabState(defaultPanelTab(artifact.lang));
    setPanelOpen(true);
  }, []);

  const closePanel = useCallback(() => setPanelOpen(false), []);

  const togglePanel = useCallback(() => {
    setPanelOpen((prev) => {
      if (prev) return false;
      return panelArtifact !== null;
    });
  }, [panelArtifact]);

  const setPanelTab = useCallback((tab: PanelTab) => setPanelTabState(tab), []);
  const [settingsPage, setSettingsPage] = useState<string | null>(null);

  const refreshModels = useCallback(async () => {
    const connection = connRef.current;
    if (!connection) {
      setModels([]);
      return;
    }
    try {
      const has = await api.hasApiKey(connection.id);
      if (!has) {
        setModels([]);
        return;
      }
      setLoadingModels(true);
      const [list, hidden] = await Promise.all([
        api.listModels(connection.id, connection.kind),
        db.listHiddenModels(connection.id),
      ]);
      const hiddenSet = new Set(hidden);
      const visible = list.filter((id) => !hiddenSet.has(id));
      setHiddenModels(hidden);
      setModels(visible);
      if (!modelRef.current && visible.length > 0) {
        setModelState(visible[0]);
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
    async (input: ConnectionInput, id?: string): Promise<Connection> => {
      let saved: Connection;
      if (id) {
        const existing = connections.find((c) => c.id === id);
        if (!existing) throw new Error("Connection no longer exists");
        saved = { ...existing, ...input };
        await db.updateConnection(saved);
      } else {
        saved = await db.createConnection(input);
        setActiveConnectionId(saved.id);
      }
      await refreshConnections();
      return saved;
    },
    [connections, refreshConnections],
  );

  const removeConnection = useCallback(
    async (id: string) => {
      await api.deleteApiKey(id).catch(() => undefined);
      await db.deleteConnection(id);
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
    () => (model ? lookupEfforts(catalog, model) : null),
    [catalog, model],
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

  const lastPayloadRef = useRef<{ role: string; content: string | api.ChatContentPart[] }[] | null>(null);
  const knowledgeBlockRef = useRef("");
  const skillIndexRef = useRef("");
  const pendingVisionFallbackRef = useRef<VisionFallback | null>(null);

  const contextInfo = useMemo(() => {
    const system = buildSystemPrompt({
      globalMemories,
      project: activeProject,
      projectMemories,
      userName: displayName || undefined,
      standingPrompt: standingPrompt || undefined,
      chatPrompt: conversations.find((item) => item.id === activeConversationId)?.system_prompt ?? undefined,
      knowledgeBlock: knowledgeBlockRef.current || undefined,
      skillIndexBlock: skillIndexRef.current || undefined,
    });
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
        pct: limitKnown ? Math.min(100, Math.round((tokens / limit) * 100)) : null,
        real: true,
        limitKnown,
        lastIn: lastUsage.prompt_tokens ?? null,
        lastOut: lastUsage.completion_tokens ?? null,
      };
    }
    const estimated = estimateContext(
      messages.filter((m) => m.content.length > 0),
      system,
      limit,
    );
    return {
      ...estimated,
      pct: limitKnown ? estimated.pct : null,
      real: false,
      limitKnown,
      lastIn: null,
      lastOut: null,
    };
  }, [
    messages,
    globalMemories,
    activeProject,
    projectMemories,
    displayName,
    standingPrompt,
    conversations,
    activeConversationId,
    modelContextLimit,
  ]);

  const resolveEffort = useCallback((): string | null => {
    const selected = reasoningEffortRef.current;
    if (!selected || selected === "none") return null;
    const supported = supportedEffortsRef.current;
    if (supported && !supported.includes(selected)) return null;
    return selected;
  }, []);

  const resolveTools = useCallback((): boolean => {
    const connection = connRef.current;
    const modelName = modelRef.current;
    if (!connection || !modelName) return false;
    return lookupSupportsTools(catalogRef.current, modelName, connection.kind);
  }, []);

  const selectProject = useCallback(
    (id: string | null) => {
      setActiveProjectId(id);
      setActiveConversationId(null);
      setMessages([]);
      setError(null);
      setView(id ? "project" : "chat");
    },
    [],
  );

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
      await db.deleteProject(id);
      if (activeProjectId === id) setActiveProjectId(null);
      await refreshProjects();
      await refreshMemories();
      setConversations(await db.listConversations());
    },
    [activeProjectId, refreshProjects, refreshMemories],
  );

  const saveMemoryToScope = useCallback(
    async (input: MemoryInput) => {
      const parsed = memoryInputSchema.safeParse(input);
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? "Invalid memory");
      }
      await db.createMemory(parsed.data);
      await refreshMemories();
    },
    [refreshMemories],
  );

  const editMemory = useCallback(
    async (id: string, draft: MemoryDraft) => {
      await db.updateMemory(id, draft.content.trim(), draft.kind);
      await refreshMemories();
    },
    [refreshMemories],
  );

  const deleteMemory = useCallback(
    async (id: string) => {
      await db.deleteMemory(id);
      await refreshMemories();
    },
    [refreshMemories],
  );

  const approvePendingMemory = useCallback(
    async (id: string) => {
      await db.approvePendingMemory(id);
      await Promise.all([refreshMemories(), refreshPendingMemories()]);
    },
    [refreshMemories, refreshPendingMemories],
  );

  const dismissPendingMemory = useCallback(
    async (id: string) => {
      await db.dismissPendingMemory(id);
      await refreshPendingMemories();
    },
    [refreshPendingMemories],
  );

  const undoApprovedMemory = useCallback(
    async (id: string) => {
      await db.restorePendingMemory(id);
      await Promise.all([refreshMemories(), refreshPendingMemories()]);
    },
    [refreshMemories, refreshPendingMemories],
  );

  const loadMemories = useCallback(
    (scope: MemoryScope, projectId: string | null) => db.listMemories(scope, projectId),
    [],
  );

  const selectConversation = useCallback(async (id: string | null) => {
    setActiveConversationId(id);
    setError(null);
    setView("chat");
    if (!id) {
      setMessages([]);
      setTodos([]);
      return;
    }
    const rows = await db.listMessages(id);
    if (convIdRef.current !== id) return;
    setMessages(rows);
    setTodos(await db.listTodos(id));
  }, []);

  const newConversation = useCallback(async () => {
    setActiveConversationId(null);
    setActiveProjectId(null);
    setMessages([]);
    setTodos([]);
    setError(null);
    setView("chat");
  }, []);

  const refreshTodos = useCallback(async (conversationId: string | null) => {
    if (!conversationId) {
      setTodos([]);
      return;
    }
    setTodos(await db.listTodos(conversationId));
  }, []);

  const removeConversation = useCallback(
    async (id: string) => {
      await db.deleteConversation(id);
      await api.deleteSpill(id).catch(() => {
        toast("Spill files may remain on disk");
      });
      setConversations(await db.listConversations());
      if (activeConversationId === id) {
        setActiveConversationId(null);
        setMessages([]);
      }
    },
    [activeConversationId],
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
  }, []);

  const finalize = useCallback((assistantId: string, conversationId: string) => {
    const content = bufferRef.current;
    const reasoning = reasoningRef.current;
    const settledLog = settleToolLog(toolLogRef.current);
    const changed = settledLog.some((entry, index) => entry !== toolLogRef.current[index]);
    toolLogRef.current = settledLog;
    const toolLogJson = settledLog.length > 0 ? JSON.stringify(settledLog) : null;
    const artifactsJson =
      artifactsRef.current.length > 0 ? JSON.stringify(artifactsRef.current) : null;
    if (!content && !reasoning && !toolLogJson && !artifactsJson) {
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
    };
    const persist = content || toolLogJson || artifactsJson
      ? db.updateMessage(assistantId, content).then(() => db.updateMessageMeta(assistantId, meta))
      : db.deleteMessage(assistantId);
    persist
      .then(() => db.touchConversation(conversationId, {}))
      .catch(reportError);
  }, []);

  const systemPromptFromRefs = useCallback(
    () =>
      buildSystemPrompt({
        globalMemories: globalMemoriesRef.current,
        project: projectRef.current,
        projectMemories: projectMemoriesRef.current,
        userName: displayNameRef.current || undefined,
        standingPrompt: standingPromptRef.current || undefined,
        chatPrompt: chatPromptRef.current ?? undefined,
        knowledgeBlock: knowledgeBlockRef.current || undefined,
        skillIndexBlock: skillIndexRef.current || undefined,
      }),
    [],
  );

  const withSystem = useCallback(
    (turns: { role: string; content: string | api.ChatContentPart[] }[], summary: string | null = null) => {
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
      payload: { role: string; content: string | api.ChatContentPart[] }[],
      assistantMsg: Message,
      keepSeed?: boolean,
    ): Promise<void> => {
      const requestId = newId();
      requestIdRef.current = requestId;
      lastPayloadRef.current = payload;
      setCanRetry(false);
      const seed = keepSeed
        ? messagesRef.current.find((m) => m.id === assistantMsg.id)
        : undefined;
      bufferRef.current = seed?.content ?? "";
      reasoningRef.current = seed?.reasoning ?? "";
      thinkingStartRef.current = null;
      thinkingMsRef.current = null;
      usageRef.current = null;
      finishRef.current = null;
      artifactsRef.current = db.parseDeclaredArtifacts(seed?.artifacts);
      assistantMsgIdRef.current = assistantMsg.id;
      setStreamingId(assistantMsg.id);
      setStreaming(true);
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
            }),
            ...fallbackFields(pendingVisionFallbackRef.current),
          },
          (event) => {
            if (requestIdRef.current !== requestId) return;
            if (event.type === "delta") {
              bufferRef.current += event.text;
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
            } else if (event.type === "finish") {
              finishRef.current = event.reason;
              if (thinkingStartRef.current !== null && thinkingMsRef.current === null) {
                thinkingMsRef.current = Date.now() - thinkingStartRef.current;
              }
            } else if (event.type === "retrying") {
              toast(`Retrying (${event.attempt}/${event.max})`);
            } else if (event.type === "tool_start") {
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
                id: `${assistantMsg.id}:tool:${artifactsRef.current.length - 1}`,
                ...declared,
              });
              toast(`Artifact saved: ${event.title}`);
            } else if (event.type === "approval_asked") {
              setApproval({
                id: event.id,
                tool: event.tool,
                command: event.command,
                cwd: event.cwd,
                screen: event.screen ?? null,
                screenFailed: event.screen_failed,
              });
            } else if (event.type === "question_asked") {
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
          const [, rows] = await Promise.all([refreshMemories(), refreshPendingMemories()]);
          const added = rows.length - waiting;
          if (added > 0) {
            toast(`${added} ${added === 1 ? "memory is" : "memories are"} waiting for review`, {
              actions: [{ label: "Review", run: () => setSettingsPage("memory") }],
            });
          }
        }
      } catch (e) {
        if (requestIdRef.current === requestId) {
          reportError(e);
          setCanRetry(lastPayloadRef.current !== null);
        }
      } finally {
        if (requestIdRef.current === requestId) {
          if (thinkingStartRef.current !== null && thinkingMsRef.current === null) {
            thinkingMsRef.current = Date.now() - thinkingStartRef.current;
          }
          setApproval(null);
          setQuestion(null);
          flush();
          requestIdRef.current = null;
          assistantMsgIdRef.current = null;
          setStreamingId(null);
          setStreaming(false);
          pendingVisionFallbackRef.current = null;
          finalize(assistantMsg.id, conversationId);
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
          trimmed = title.trim();
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
    (conversationId: string | null, turns: { role: string; content: string | api.ChatContentPart[] }[]) => {
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
      if (!id || !connection || !model || streaming) {
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
    [streaming],
  );

  const maybeAutoCompact = useCallback(
    async (conversationId: string) => {
      if (!autoCompactRef.current) return;
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
    (conversationId: string | null, turns: { role: string; content: string | api.ChatContentPart[]; attachments?: string | null; created_at?: number }[]) => {
      const { summary, through } = summaryFor(conversationId);
      const windowed = summary
        ? applySummaryWindow(turns, { summary, through })
        : applyCompactWindow(turns, resolveCompact(conversationId, turns));
      const activeModelSees =
        canSeeImages(connRef.current?.id ?? null, modelRef.current) ||
        (knownVisionFallback(visionFallbackRef.current, connections) !== null && resolveTools());
      const shaped = activeModelSees ? withFinalTurnImages(windowed) : windowed;
      const slim = shaped.map((turn) => ({
        role: turn.role,
        content: turn.content,
      }));
      return withSystem(slim, summary);
    },
    [canSeeImages, connections, resolveCompact, resolveTools, summaryFor, withSystem],
  );

  const sendMessage = useCallback(
    async (
      text: string,
      images?: { dataUrl: string }[],
      docs?: ChatDocument[],
    ): Promise<boolean> => {
      if (streaming) return false;
      const connection = connRef.current;
      if (!connection) {
        setError("Add a connection in Settings first.");
        return false;
      }
      if (!modelRef.current) {
        setError("Select a model first.");
        return false;
      }

      setError(null);
      const history = messages.filter((m) => m.content.length > 0);

      let conversationId = convIdRef.current;
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
          setConversations((prev) => [created, ...prev]);
          setActiveConversationId(created.id);
          setMessages([]);
          setTodos([]);
        }

        userMsg = await db.addMessage(conversationId, "user", text);
        assistantMsg = await db.addMessage(conversationId, "assistant", "", modelRef.current);
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

      const outgoing: { role: string; content: string | api.ChatContentPart[] }[] = [
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
      try {
        if (projectRef.current) {
          knowledge = await searchKnowledge(projectRef.current.id, text);
        }
      } catch {
        knowledge = "";
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
      outgoing.push({ role: "user", content: userContent });
      const payload = buildPayload(conversationId, outgoing);

      await streamTurn(conversationId, connection, modelRef.current, payload, assistantMsg);
      if (provisionalTitle) {
        void maybeGenerateTitle(conversationId, provisionalTitle, text, bufferRef.current);
      }
      await maybeAutoCompact(conversationId);
      return true;
    },
    [
      canSeeImages,
      connections,
      conversations,
      finalize,
      messages,
      streaming,
      streamTurn,
      buildPayload,
      resolveTools,
      maybeGenerateTitle,
      maybeAutoCompact,
    ],
  );

  const regenerate = useCallback(async () => {
    const conversationId = convIdRef.current;
    const connection = connRef.current;
    if (!conversationId || !connection || !modelRef.current || streaming) return;
    const turns = messagesRef.current.filter((m) => m.content.length > 0);
    if (turns.length === 0 || turns[turns.length - 1].role !== "assistant") return;
    const dropped = turns[turns.length - 1];
    const kept = turns.slice(0, -1);
    try {
      await db.deleteMessage(dropped.id);
    } catch (e) {
      reportError(e);
      return;
    }
    setMessages(kept);
    let assistantMsg: Message;
    try {
      assistantMsg = await db.addMessage(conversationId, "assistant", "", modelRef.current);
    } catch (e) {
      reportError(e);
      return;
    }
    setMessages([...kept, assistantMsg]);
    await streamTurn(
      conversationId,
      connection,
      modelRef.current,
      buildPayload(conversationId, await withDocumentBlock(kept, projectRef.current?.id ?? null)),
      assistantMsg,
    );
  }, [streaming, streamTurn, buildPayload]);

  const continueTurn = useCallback(async () => {
    const conversationId = convIdRef.current;
    const connection = connRef.current;
    if (!conversationId || !connection || !modelRef.current || streaming) return;
    const turns = messagesRef.current.filter((m) => m.content.length > 0);
    if (turns.length === 0 || turns[turns.length - 1].role !== "assistant") return;
    const partial = turns[turns.length - 1];
    if (partial.finish_reason !== "length" && partial.finish_reason !== "interrupted") return;
    const payload =
      lastPayloadRef.current ??
      buildPayload(conversationId, await withDocumentBlock(turns, projectRef.current?.id ?? null));
    await streamTurn(
      conversationId,
      connection,
      modelRef.current,
      payload,
      partial,
      true,
    );
  }, [streaming, streamTurn, buildPayload]);

  const retryTurn = useCallback(async () => {    const conversationId = convIdRef.current;
    const connection = connRef.current;
    const payload = lastPayloadRef.current;
    if (!conversationId || !connection || !modelRef.current || streaming || !payload) return;
    setError(null);
    let assistantMsg: Message;
    try {
      assistantMsg = await db.addMessage(conversationId, "assistant", "", modelRef.current);
    } catch (e) {
      reportError(e);
      return;
    }
    setMessages((prev) => [...prev, assistantMsg]);
    await streamTurn(conversationId, connection, modelRef.current, payload, assistantMsg);
  }, [streaming, streamTurn]);

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
      if (!conversationId || !connection || !modelRef.current || streaming) return false;
      const trimmed = text.trim();
      if (!trimmed) return false;
      try {
        await db.updateMessage(userId, trimmed);
        await db.truncateConversation(conversationId, userId);
      } catch (e) {
        reportError(e);
        return false;
      }
      const kept = (await db.listMessages(conversationId)).filter(
        (m) => m.content.length > 0,
      );
      let assistantMsg: Message;
      try {
        assistantMsg = await db.addMessage(conversationId, "assistant", "", modelRef.current);
      } catch (e) {
        reportError(e);
        return false;
      }
      setMessages([...kept, assistantMsg]);
      await streamTurn(
        conversationId,
        connection,
        modelRef.current,
        buildPayload(
          conversationId,
          await withDocumentBlock(kept, projectRef.current?.id ?? null),
        ),
        assistantMsg,
      );
      return true;
    },
    [streaming, streamTurn, buildPayload],
  );

  const branchFrom = useCallback(
    async (messageId: string) => {
      const conversationId = convIdRef.current;
      if (!conversationId || streaming) return;
      const source = conversations.find((c) => c.id === conversationId);
      if (!source) return;
      try {
        const branched = await db.branchConversation(
          conversationId,
          messageId,
          `${source.title} (branch)`,
        );
        setConversations((prev) => [branched, ...prev]);
        setActiveConversationId(branched.id);
        await copyChatDocs(conversationId, branched.id);
        const rows = await db.listMessages(branched.id);
        setMessages(rows);
        toast("Branched into new chat");
      } catch (e) {
        reportError(e);
      }
    },
    [conversations, streaming],
  );

  const startProjectChat = useCallback(
    async (projectId: string, text: string): Promise<boolean> => {
      const connection = connRef.current;
      if (!connection || !modelRef.current || streaming) return false;
      const trimmed = text.trim();
      if (!trimmed) return false;
      setError(null);
      try {
        const created = await db.createConversation(connection.id, modelRef.current, projectId);
        const userMsg = await db.addMessage(created.id, "user", trimmed);
        const assistantMsg = await db.addMessage(created.id, "assistant", "", modelRef.current);
        const title = deriveFallbackTitle(trimmed);
        await db.touchConversation(created.id, { title });
        setConversations((prev) => [{ ...created, title }, ...prev]);
        setActiveConversationId(created.id);
        setActiveProjectId(projectId);
        setView("chat");
        setMessages([userMsg, assistantMsg]);
        const firstTurns = [{ role: "user", content: trimmed }];
        await streamTurn(
          created.id,
          connection,
          modelRef.current,
          buildPayload(created.id, firstTurns),
          assistantMsg,
        );
        void maybeGenerateTitle(created.id, title, trimmed, bufferRef.current);
        return true;
      } catch (e) {
        reportError(e);
        return false;
      }
    },
    [streaming, streamTurn, buildPayload, maybeGenerateTitle],
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
    } catch (e) {
      reportError(e);
    }
  }, []);

  const stopStream = useCallback(() => {
    const id = requestIdRef.current;
    if (!id) return;
    requestIdRef.current = null;
    setStreamingId(null);
    setStreaming(false);
    api.cancelStream(id).catch(reportError);
    const assistantId = assistantMsgIdRef.current;
    const conversationId = convIdRef.current;
    assistantMsgIdRef.current = null;
    if (assistantId && conversationId) {
      finishRef.current = "stopped";
      setMessages((prev) =>
        prev.map((m) =>
          m.id === assistantId ? { ...m, finish_reason: "stopped" } : m,
        ),
      );
      finalize(assistantId, conversationId);
    }
  }, [finalize]);

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
    pendingMemories,
    refreshMemories,
    refreshPendingMemories,
    loadMemories,
    addMemory: saveMemoryToScope,
    editMemory,
    deleteMemory,
    approvePendingMemory,
    dismissPendingMemory,
    undoApprovedMemory,
    conversations,
    activeConversationId,
    selectConversation,
    refreshConversations,
    newConversation,
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
    sendMessage,
    fileCommands,
    loadFileCommands,
    regenerate,
    continueTurn,
    editAndResubmit,
    branchFrom,
    clearActiveConversation,
    compactActive,
    uncompactActive,
    compacting,
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
    searchBackend,
    setSearchBackend,
    searchEndpoint,
    setSearchEndpoint,
    todos,
    refreshTodos,
    panelOpen,
    panelArtifact,
    panelTab,
    panelMode,
    panelWidth,
    openArtifact,
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
