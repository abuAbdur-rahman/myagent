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
import { applyCompactWindow, buildSystemPrompt, estimateContext } from "./context";
import {
  fetchCatalog,
  lookupContextLength,
  lookupEfforts,
  type ModelCapabilities,
} from "./catalog";
import { toast } from "./toast";
import { memoryInputSchema } from "./types";
import { newId } from "./utils";
import type {
  Connection,
  ConnectionInput,
  Conversation,
  Memory,
  MemoryDraft,
  MemoryInput,
  MemoryScope,
  Project,
  ProjectInput,
  Message,
} from "./types";

const ACTIVE_CONNECTION_KEY = "activeConnectionId";
const ACTIVE_PROJECT_KEY = "activeProjectId";
const MODEL_KEY = "model";
const SIDEBAR_KEY = "sidebarCollapsed";
const THEME_KEY = "theme";
const DISPLAY_NAME_KEY = "displayName";

export type ThemeMode = "system" | "light" | "dark";

interface ToolEntry {
  id: string;
  name: string;
  summary: string;
  status: "running" | "ok" | "err";
  preview: string | null;
}

type View = "chat" | "projects" | "project";

export type PanelTab = "preview" | "code" | "doc" | "source";

interface PanelArtifact {
  lang: string;
  code: string;
}

function defaultPanelTab(lang: string): PanelTab {
  const normalized = lang.toLowerCase();
  if (normalized === "html" || normalized === "htm") return "preview";
  if (normalized === "md" || normalized === "markdown") return "doc";
  return "code";
}

interface AppContextValue {
  ready: boolean;
  error: string | null;
  clearError: () => void;
  canRetry: boolean;
  retryTurn: () => Promise<void>;
  approval: { id: string; tool: string; command: string; cwd: string } | null;
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
  toggleModelVisibility: (connectionId: string, modelId: string, hidden: boolean) => Promise<void>;
  setAllModelsVisibility: (
    connectionId: string,
    modelIds: string[],
    hidden: boolean,
  ) => Promise<void>;
  model: string;
  setModel: (model: string) => void;
  reasoningEffort: string | null;
  setReasoningEffort: (effort: string | null) => void;
  supportedEfforts: string[] | null;
  modelContextLimit: number | null;
  contextInfo: {
    tokens: number;
    limit: number;
    pct: number;
    real: boolean;
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

  globalMemories: Memory[];
  projectMemories: Memory[];
  refreshMemories: () => Promise<void>;
  loadMemories: (scope: MemoryScope, projectId: string | null) => Promise<Memory[]>;
  addMemory: (input: MemoryInput) => Promise<void>;
  editMemory: (id: string, draft: MemoryDraft) => Promise<void>;
  deleteMemory: (id: string) => Promise<void>;

  conversations: Conversation[];
  activeConversationId: string | null;
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
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  paletteOpen: boolean;
  setPaletteOpen: (open: boolean) => void;
  onboarded: boolean;
  completeOnboarding: () => void;
  displayName: string;
  setDisplayName: (name: string) => void;
  settingsPage: string | null;
  setSettingsPage: (page: string | null) => void;

  messages: Message[];
  streaming: boolean;
  toolLog: ToolEntry[];
  sendMessage: (text: string) => Promise<boolean>;
  regenerate: () => Promise<void>;
  continueTurn: () => Promise<void>;
  editAndResubmit: (userId: string, text: string) => Promise<boolean>;
  branchFrom: (messageId: string) => Promise<void>;
  clearActiveConversation: () => Promise<void>;
  compactActive: () => Promise<void>;
  uncompactActive: () => Promise<void>;
  stopStream: () => void;
  composerDraft: string;
  setComposerDraft: (value: string) => void;
  composerSignal: { id: number; text: string | null } | null;
  setComposerText: (text: string) => void;
  sendWith: "enter" | "ctrl";
  setSendWith: (mode: "enter" | "ctrl") => void;
  panelOpen: boolean;
  panelArtifact: PanelArtifact | null;
  panelTab: PanelTab;
  openArtifact: (artifact: PanelArtifact) => void;
  closePanel: () => void;
  togglePanel: () => void;
  setPanelTab: (tab: PanelTab) => void;
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
  const [reasoningEffort, setReasoningEffortState] = useState<string | null>(() =>
    localStorage.getItem("reasoningEffort"),
  );
  const [catalog, setCatalog] = useState<ModelCapabilities[] | null>(null);
  const [hiddenModels, setHiddenModels] = useState<string[]>([]);
  const [displayName, setDisplayNameState] = useState(
    () => localStorage.getItem(DISPLAY_NAME_KEY) ?? "",
  );

  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(
    () => localStorage.getItem(ACTIVE_PROJECT_KEY),
  );
  const [view, setView] = useState<View>("chat");
  const [globalMemories, setGlobalMemories] = useState<Memory[]>([]);
  const [projectMemories, setProjectMemories] = useState<Memory[]>([]);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [toolLog, setToolLog] = useState<ToolEntry[]>([]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem(SIDEBAR_KEY) === "1",
  );
  const [theme, setThemeState] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === "light" || saved === "dark" ? saved : "system";
  });

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
  const modelRef = useRef(model);
  const convIdRef = useRef<string | null>(null);
  const messagesRef = useRef<Message[]>([]);
  const [composerDraft, setComposerDraftState] = useState(
    () => localStorage.getItem("composerDraft") ?? "",
  );
  const [sendWith, setSendWithState] = useState<"enter" | "ctrl">(() =>
    localStorage.getItem("sendWith") === "ctrl" ? "ctrl" : "enter",
  );
  const globalMemoriesRef = useRef<Memory[]>([]);
  const projectMemoriesRef = useRef<Memory[]>([]);
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
    modelRef.current = model;
  }, [model]);
  useEffect(() => {
    convIdRef.current = activeConversationId;
  }, [activeConversationId]);
  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);
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

  const refreshMemories = useCallback(async () => {
    const projectId = projectRef.current?.id ?? null;
    const [global, project] = await Promise.all([
      db.listMemories("global", null),
      projectId ? db.listMemories("project", projectId) : Promise.resolve<Memory[]>([]),
    ]);
    setGlobalMemories(global);
    setProjectMemories(project);
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await refreshConnections();
        await refreshProjects();
        await refreshMemories();
        setConversations(await db.listConversations());
      } catch (e) {
        reportError(e);
      } finally {
        setReady(true);
      }
    })();
  }, [refreshConnections, refreshProjects, refreshMemories]);

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

  const setDisplayName = useCallback((name: string) => {
    setDisplayNameState(name);
    if (name.trim()) {
      localStorage.setItem(DISPLAY_NAME_KEY, name.trim());
    } else {
      localStorage.removeItem(DISPLAY_NAME_KEY);
    }
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

  const openArtifact = useCallback((artifact: PanelArtifact) => {
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
        api.listModels(connection.base_url, connection.id),
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
    if (!activeConnection || activeConnection.kind !== "openrouter") {
      setCatalog(null);
      return;
    }
    let live = true;
    fetchCatalog()
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

  const modelContextLimit = useMemo(
    () => (model ? (lookupContextLength(catalog, model) ?? null) : null),
    [catalog, model],
  );
  const contextLimitRef = useRef(128_000);
  useEffect(() => {
    contextLimitRef.current = modelContextLimit ?? 128_000;
  }, [modelContextLimit]);

  const contextInfo = useMemo(() => {
    const system = buildSystemPrompt({
      globalMemories,
      project: activeProject,
      projectMemories,
      userName: displayName || undefined,
    });
    const limit = modelContextLimit ?? 128_000;
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
        lastIn: lastUsage.prompt_tokens ?? null,
        lastOut: lastUsage.completion_tokens ?? null,
      };
    }
    return {
      ...estimateContext(
        messages.filter((m) => m.content.length > 0),
        system,
        limit,
      ),
      real: false,
      lastIn: null,
      lastOut: null,
    };
  }, [messages, globalMemories, activeProject, projectMemories, displayName, modelContextLimit]);

  const resolveEffort = useCallback((): string | null => {
    const selected = reasoningEffortRef.current;
    if (!selected || selected === "none") return null;
    const supported = supportedEffortsRef.current;
    if (supported && !supported.includes(selected)) return null;
    return selected;
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

  const loadMemories = useCallback(
    (scope: MemoryScope, projectId: string | null) => db.listMemories(scope, projectId),
    [],
  );

  const selectConversation = useCallback(async (id: string | null) => {
    setActiveConversationId(id);
    setError(null);
    setToolLog([]);
    setView("chat");
    if (!id) {
      setMessages([]);
      return;
    }
    setMessages(await db.listMessages(id));
  }, []);

  const newConversation = useCallback(async () => {
    setActiveConversationId(null);
    setMessages([]);
    setToolLog([]);
    setError(null);
    setView("chat");
  }, []);

  const removeConversation = useCallback(
    async (id: string) => {
      await db.deleteConversation(id);
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
    if (!content && !reasoning) {
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
    }
    const usage = usageRef.current;
    const meta = {
      reasoning: reasoning || null,
      thinkingMs: thinkingMsRef.current,
      promptTokens: usage?.prompt ?? null,
      completionTokens: usage?.completion ?? null,
      totalTokens: usage?.total ?? null,
      finishReason: finishRef.current,
    };
    const persist = content
      ? db.updateMessage(assistantId, content).then(() => db.updateMessageMeta(assistantId, meta))
      : db.deleteMessage(assistantId);
    persist
      .then(() => db.touchConversation(conversationId, {}))
      .catch(reportError);
  }, []);

  const withSystem = useCallback(
    (turns: { role: string; content: string }[]) => {
      const system = buildSystemPrompt({
        globalMemories: globalMemoriesRef.current,
        project: projectRef.current,
        projectMemories: projectMemoriesRef.current,
        userName: displayNameRef.current || undefined,
      });
      return [...(system ? [{ role: "system", content: system }] : []), ...turns];
    },
    [],
  );

  const lastPayloadRef = useRef<{ role: string; content: string }[] | null>(null);

  const streamTurn = useCallback(
    async (
      conversationId: string,
      connection: Connection,
      modelName: string,
      payload: { role: string; content: string }[],
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
      reasoningRef.current = "";
      thinkingStartRef.current = null;
      thinkingMsRef.current = null;
      usageRef.current = null;
      finishRef.current = null;
      assistantMsgIdRef.current = assistantMsg.id;
      setStreaming(true);
      setToolLog([]);
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
              ? { ...m, content: buffered, reasoning, thinking_ms: thinkingMs }
              : m,
          ),
        );
      };

      try {
        await api.chatStream(
          {
            requestId,
            baseUrl: connection.base_url,
            connectionId: connection.id,
            model: modelName,
            messages: payload,
            enableTools: true,
            projectId: projectRef.current?.id ?? null,
            reasoningEffort: resolveEffort(),
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
            } else if (event.type === "tool_start") {
              setToolLog((prev) => [
                ...prev,
                {
                  id: event.id,
                  name: event.name,
                  summary: event.summary,
                  status: "running" as const,
                  preview: null,
                },
              ]);
            } else if (event.type === "tool_result") {
              setToolLog((prev) =>
                prev.map((entry) =>
                  entry.id === event.id
                    ? { ...entry, status: event.ok ? ("ok" as const) : ("err" as const), preview: event.preview }
                    : entry,
                ),
              );
            } else if (event.type === "artifact") {
              openArtifact({ lang: event.lang, code: event.code });
              toast(`Artifact saved: ${event.title}`);
            } else if (event.type === "approval_asked") {
              setApproval({
                id: event.id,
                tool: event.tool,
                command: event.command,
                cwd: event.cwd,
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
          flush();
          requestIdRef.current = null;
          assistantMsgIdRef.current = null;
          setStreaming(false);
          finalize(assistantMsg.id, conversationId);
        }
      }
    },
    [finalize, openArtifact, resolveEffort],
  );

  const resolveCompact = useCallback(
    (conversationId: string | null, turns: { role: string; content: string }[]) => {
      const conversation = conversationId
        ? conversationsRef.current.find((c) => c.id === conversationId)
        : undefined;
      if (conversation?.compacted === 1) return true;
      const system = buildSystemPrompt({
        globalMemories: globalMemoriesRef.current,
        project: projectRef.current,
        projectMemories: projectMemoriesRef.current,
        userName: displayNameRef.current || undefined,
      });
      if (estimateContext(turns, system, contextLimitRef.current).pct > 80) {
        toast("Context is over 80% full — sending recent messages only.");
        return true;
      }
      return false;
    },
    [],
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
      try {
        const title = await api.suggestTitle(
          connection.base_url,
          connection.id,
          modelRef.current,
          userText,
          assistantText,
        );
        const trimmed = title.trim();
        if (!trimmed) return;
        if (
          conversationsRef.current.find((c) => c.id === conversationId)?.title !==
          provisionalTitle
        ) {
          return;
        }
        await db.touchConversation(conversationId, { title: trimmed });
        setConversations((prev) =>
          prev.map((c) => (c.id === conversationId ? { ...c, title: trimmed } : c)),
        );
      } catch {
        // best-effort; the user-text title stays
      }
    },
    [],
  );

  const sendMessage = useCallback(
    async (text: string): Promise<boolean> => {
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
        }

        const userMsg = await db.addMessage(conversationId, "user", text);
        assistantMsg = await db.addMessage(conversationId, "assistant", "");
        setMessages((prev) => [...prev, userMsg, assistantMsg]);

        const current = conversations.find((c) => c.id === conversationId);
        if (!current || current.title === "New chat") {
          provisionalTitle = text.slice(0, 48) || "New chat";
          await db.touchConversation(conversationId, {
            title: provisionalTitle,
            model: modelRef.current,
          });
          setConversations((prev) =>
            prev.map((c) =>
              c.id === conversationId ? { ...c, title: provisionalTitle as string } : c,
            ),
          );
        } else {
          await db.touchConversation(conversationId, { model: modelRef.current });
        }
      } catch (e) {
        reportError(e);
        return false;
      }

      const turns = [...history, { role: "user", content: text }];
      const payload = withSystem(applyCompactWindow(turns, resolveCompact(conversationId, turns)));

      await streamTurn(conversationId, connection, modelRef.current, payload, assistantMsg);
      if (provisionalTitle) {
        void maybeGenerateTitle(conversationId, provisionalTitle, text, bufferRef.current);
      }
      return true;
    },
    [
      conversations,
      finalize,
      messages,
      streaming,
      streamTurn,
      withSystem,
      resolveCompact,
      maybeGenerateTitle,
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
      assistantMsg = await db.addMessage(conversationId, "assistant", "");
    } catch (e) {
      reportError(e);
      return;
    }
    setMessages([...kept, assistantMsg]);
    await streamTurn(
      conversationId,
      connection,
      modelRef.current,
      withSystem(applyCompactWindow(kept, resolveCompact(conversationId, kept))),
      assistantMsg,
    );
  }, [streaming, streamTurn, withSystem, resolveCompact]);

  const continueTurn = useCallback(async () => {
    const conversationId = convIdRef.current;
    const connection = connRef.current;
    if (!conversationId || !connection || !modelRef.current || streaming) return;
    const turns = messagesRef.current.filter((m) => m.content.length > 0);
    if (turns.length === 0 || turns[turns.length - 1].role !== "assistant") return;
    const partial = turns[turns.length - 1];
    if (partial.finish_reason !== "length") return;
    const payload = lastPayloadRef.current ?? withSystem(applyCompactWindow(turns, false));
    await streamTurn(
      conversationId,
      connection,
      modelRef.current,
      payload,
      partial,
      true,
    );
  }, [streaming, streamTurn, withSystem]);

  const retryTurn = useCallback(async () => {    const conversationId = convIdRef.current;
    const connection = connRef.current;
    const payload = lastPayloadRef.current;
    if (!conversationId || !connection || !modelRef.current || streaming || !payload) return;
    setError(null);
    let assistantMsg: Message;
    try {
      assistantMsg = await db.addMessage(conversationId, "assistant", "");
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
        assistantMsg = await db.addMessage(conversationId, "assistant", "");
      } catch (e) {
        reportError(e);
        return false;
      }
      setMessages([...kept, assistantMsg]);
      await streamTurn(
        conversationId,
        connection,
        modelRef.current,
        withSystem(applyCompactWindow(kept, resolveCompact(conversationId, kept))),
        assistantMsg,
      );
      return true;
    },
    [streaming, streamTurn, withSystem, resolveCompact],
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
        setMessages(await db.listMessages(branched.id));
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
        const assistantMsg = await db.addMessage(created.id, "assistant", "");
        const title = trimmed.slice(0, 48) || "New chat";
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
          withSystem(applyCompactWindow(firstTurns, resolveCompact(created.id, firstTurns))),
          assistantMsg,
        );
        void maybeGenerateTitle(created.id, title, trimmed, bufferRef.current);
        return true;
      } catch (e) {
        reportError(e);
        return false;
      }
    },
    [streaming, streamTurn, withSystem, resolveCompact, maybeGenerateTitle],
  );

  const clearActiveConversation = useCallback(async () => {
    const id = convIdRef.current;
    if (!id) return;
    try {
      await db.clearConversation(id);
      setMessages([]);
      await db.touchConversation(id, {});
    } catch (e) {
      reportError(e);
    }
  }, []);

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

  const compactActive = useCallback(async () => {
    const id = convIdRef.current;
    if (!id) return;
    await setCompacted(id, true);
  }, [setCompacted]);

  const uncompactActive = useCallback(async () => {
    const id = convIdRef.current;
    if (!id) return;
    await setCompacted(id, false);
  }, [setCompacted]);

  const stopStream = useCallback(() => {
    const id = requestIdRef.current;
    if (!id) return;
    requestIdRef.current = null;
    setStreaming(false);
    api.cancelStream(id).catch(reportError);
    const assistantId = assistantMsgIdRef.current;
    const conversationId = convIdRef.current;
    assistantMsgIdRef.current = null;
    if (assistantId && conversationId) finalize(assistantId, conversationId);
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
    toggleModelVisibility,
    setAllModelsVisibility,
    model,
    setModel,
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
    globalMemories,
    projectMemories,
    refreshMemories,
    loadMemories,
    addMemory: saveMemoryToScope,
    editMemory,
    deleteMemory,
    conversations,
    activeConversationId,
    selectConversation,
    newConversation,
    removeConversation,
    renameConversation,
    togglePin,
    moveConversation,
    displayName,
    setDisplayName,
    theme,
    setTheme,
    accent,
    setAccent,
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
    toolLog,
    sendMessage,
    regenerate,
    continueTurn,
    editAndResubmit,
    branchFrom,
    clearActiveConversation,
    compactActive,
    uncompactActive,
    stopStream,
    composerDraft,
    setComposerDraft,
    composerSignal,
    setComposerText,
    sendWith,
    setSendWith,
    panelOpen,
    panelArtifact,
    panelTab,
    openArtifact,
    closePanel,
    togglePanel,
    setPanelTab,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
