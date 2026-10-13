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
import { buildSystemPrompt } from "./context";
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

interface AppContextValue {
  ready: boolean;
  error: string | null;
  clearError: () => void;

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
  model: string;
  setModel: (model: string) => void;

  projects: Project[];
  activeProject: Project | null;
  activeProjectId: string | null;
  selectProject: (id: string | null) => void;
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

  messages: Message[];
  streaming: boolean;
  sendMessage: (text: string) => Promise<boolean>;
  stopStream: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [connections, setConnections] = useState<Connection[]>([]);
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(
    () => localStorage.getItem(ACTIVE_CONNECTION_KEY),
  );
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [model, setModelState] = useState(() => localStorage.getItem(MODEL_KEY) ?? "");

  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(
    () => localStorage.getItem(ACTIVE_PROJECT_KEY),
  );
  const [globalMemories, setGlobalMemories] = useState<Memory[]>([]);
  const [projectMemories, setProjectMemories] = useState<Memory[]>([]);

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);

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
  const modelRef = useRef(model);
  const convIdRef = useRef<string | null>(null);
  const globalMemoriesRef = useRef<Memory[]>([]);
  const projectMemoriesRef = useRef<Memory[]>([]);
  const requestIdRef = useRef<string | null>(null);
  const bufferRef = useRef("");
  const assistantMsgIdRef = useRef<string | null>(null);

  useEffect(() => {
    connRef.current = activeConnection;
  }, [activeConnection]);
  useEffect(() => {
    projectRef.current = activeProject;
  }, [activeProject]);
  useEffect(() => {
    modelRef.current = model;
  }, [model]);
  useEffect(() => {
    convIdRef.current = activeConversationId;
  }, [activeConversationId]);
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
        setError(String(e));
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
      const list = await api.listModels(connection.base_url, connection.id);
      setModels(list);
      if (!modelRef.current && list.length > 0) {
        setModelState(list[0]);
      }
    } catch (e) {
      setModels([]);
      setError(String(e));
    } finally {
      setLoadingModels(false);
    }
  }, []);

  useEffect(() => {
    if (ready) void refreshModels();
  }, [ready, activeConnection, refreshModels]);

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

  const selectProject = useCallback(
    (id: string | null) => {
      setActiveProjectId(id);
      setActiveConversationId(null);
      setMessages([]);
      setError(null);
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
    if (!id) {
      setMessages([]);
      return;
    }
    setMessages(await db.listMessages(id));
  }, []);

  const newConversation = useCallback(async () => {
    setActiveConversationId(null);
    setMessages([]);
    setError(null);
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

  const finalize = useCallback((assistantId: string, conversationId: string) => {
    const content = bufferRef.current;
    if (!content) {
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
    }
    const persist = content
      ? db.updateMessage(assistantId, content)
      : db.deleteMessage(assistantId);
    persist
      .then(() => db.touchConversation(conversationId, {}))
      .catch((e) => setError(String(e)));
  }, []);

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
          const title = text.slice(0, 48) || "New chat";
          await db.touchConversation(conversationId, { title, model: modelRef.current });
          setConversations((prev) =>
            prev.map((c) => (c.id === conversationId ? { ...c, title } : c)),
          );
        } else {
          await db.touchConversation(conversationId, { model: modelRef.current });
        }
      } catch (e) {
        setError(String(e));
        return false;
      }

      const system = buildSystemPrompt({
        globalMemories: globalMemoriesRef.current,
        project: projectRef.current,
        projectMemories: projectMemoriesRef.current,
      });

      const payload = [
        ...(system ? [{ role: "system" as const, content: system }] : []),
        ...history,
        { role: "user" as const, content: text },
      ].map((m) => ({ role: m.role, content: m.content }));

      const requestId = newId();
      requestIdRef.current = requestId;
      bufferRef.current = "";
      assistantMsgIdRef.current = assistantMsg.id;
      setStreaming(true);

      try {
        await api.chatStream(
          {
            requestId,
            baseUrl: connection.base_url,
            connectionId: connection.id,
            model: modelRef.current,
            messages: payload,
          },
          (event) => {
            if (requestIdRef.current !== requestId) return;
            if (event.type === "delta") {
              bufferRef.current += event.text;
              const buffered = bufferRef.current;
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantMsg.id ? { ...m, content: buffered } : m)),
              );
            }
          },
        );
      } catch (e) {
        if (requestIdRef.current === requestId) setError(String(e));
      } finally {
        if (requestIdRef.current === requestId) {
          requestIdRef.current = null;
          assistantMsgIdRef.current = null;
          setStreaming(false);
          finalize(assistantMsg.id, conversationId);
        }
      }

      return true;
    },
    [conversations, finalize, messages, streaming],
  );

  const stopStream = useCallback(() => {
    const id = requestIdRef.current;
    if (!id) return;
    requestIdRef.current = null;
    setStreaming(false);
    api.cancelStream(id).catch((e) => setError(String(e)));
    const assistantId = assistantMsgIdRef.current;
    const conversationId = convIdRef.current;
    assistantMsgIdRef.current = null;
    if (assistantId && conversationId) finalize(assistantId, conversationId);
  }, [finalize]);

  const value: AppContextValue = {
    ready,
    error,
    clearError: () => setError(null),
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
    model,
    setModel,
    projects,
    activeProject,
    activeProjectId,
    selectProject,
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
    messages,
    streaming,
    sendMessage,
    stopStream,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
