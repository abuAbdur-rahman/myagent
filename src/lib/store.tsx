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
import { newId } from "./utils";
import type {
  Connection,
  ConnectionInput,
  Conversation,
  Message,
} from "./types";

interface AppContextValue {
  ready: boolean;
  error: string | null;
  clearError: () => void;

  connections: Connection[];
  activeConnection: Connection | null;
  activeConnectionId: string | null;
  selectConnection: (id: string | null) => void;
  refreshConnections: () => Promise<void>;
  saveConnection: (input: ConnectionInput, id?: string) => Promise<void>;
  removeConnection: (id: string) => Promise<void>;

  models: string[];
  loadingModels: boolean;
  refreshModels: () => Promise<void>;
  model: string;
  setModel: (model: string) => void;

  conversations: Conversation[];
  activeConversationId: string | null;
  selectConversation: (id: string | null) => Promise<void>;
  newConversation: () => Promise<void>;
  removeConversation: (id: string) => Promise<void>;

  messages: Message[];
  streaming: boolean;
  sendMessage: (text: string) => Promise<void>;
  stopStream: () => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [connections, setConnections] = useState<Connection[]>([]);
  const [activeConnectionId, setActiveConnectionId] = useState<string | null>(
    () => localStorage.getItem("activeConnectionId"),
  );
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [model, setModelState] = useState(() => localStorage.getItem("model") ?? "");

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [streaming, setStreaming] = useState(false);

  const activeConnection = useMemo(
    () => connections.find((c) => c.id === activeConnectionId) ?? null,
    [connections, activeConnectionId],
  );

  const connRef = useRef<Connection | null>(null);
  const modelRef = useRef(model);
  const convIdRef = useRef<string | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const bufferRef = useRef("");
  const assistantMsgIdRef = useRef<string | null>(null);

  useEffect(() => {
    connRef.current = activeConnection;
  }, [activeConnection]);
  useEffect(() => {
    modelRef.current = model;
  }, [model]);
  useEffect(() => {
    convIdRef.current = activeConversationId;
  }, [activeConversationId]);

  const refreshConnections = useCallback(async () => {
    const rows = await db.listConnections();
    setConnections(rows);
    if (!activeConnectionId && rows.length > 0) {
      setActiveConnectionId(rows[0].id);
    }
  }, [activeConnectionId]);

  useEffect(() => {
    (async () => {
      try {
        await refreshConnections();
        setConversations(await db.listConversations());
      } catch (e) {
        setError(String(e));
      } finally {
        setReady(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (activeConnectionId) localStorage.setItem("activeConnectionId", activeConnectionId);
    else localStorage.removeItem("activeConnectionId");
  }, [activeConnectionId]);

  useEffect(() => {
    if (model) localStorage.setItem("model", model);
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
  }, [ready, activeConnectionId, refreshModels]);

  const selectConnection = useCallback((id: string | null) => {
    setActiveConnectionId(id);
    setModels([]);
  }, []);

  const saveConnection = useCallback(
    async (input: ConnectionInput, id?: string) => {
      if (id) {
        const existing = connections.find((c) => c.id === id);
        if (existing) await db.updateConnection({ ...existing, ...input });
      } else {
        const created = await db.createConnection(input);
        setActiveConnectionId(created.id);
      }
      await refreshConnections();
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

  const selectConversation = useCallback(
    async (id: string | null) => {
      setActiveConversationId(id);
      setError(null);
      if (!id) {
        setMessages([]);
        return;
      }
      setMessages(await db.listMessages(id));
    },
    [],
  );

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
    if (content) {
      void db.updateMessage(assistantId, content);
    } else {
      setMessages((prev) => prev.filter((m) => m.id !== assistantId));
    }
    void db.touchConversation(conversationId, {});
  }, []);

  const sendMessage = useCallback(
    async (text: string) => {
      if (streaming) return;
      const connection = connRef.current;
      if (!connection) {
        setError("Add a connection in Settings first.");
        return;
      }
      if (!modelRef.current) {
        setError("Select a model first.");
        return;
      }

      setError(null);
      const history = messages.filter((m) => m.content.length > 0);

      let conversationId = convIdRef.current;
      if (!conversationId) {
        const created = await db.createConversation(connection.id, modelRef.current);
        conversationId = created.id;
        setConversations((prev) => [created, ...prev]);
        setActiveConversationId(created.id);
        setMessages([]);
      }

      const userMsg = await db.addMessage(conversationId, "user", text);
      const assistantMsg: Message = {
        id: newId(),
        conversation_id: conversationId,
        role: "assistant",
        content: "",
        created_at: Date.now(),
      };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);

      const currentConversation = conversations.find((c) => c.id === conversationId);
      if (!currentConversation || currentConversation.title === "New chat") {
        const title = text.slice(0, 48) || "New chat";
        await db.touchConversation(conversationId, { title, model: modelRef.current });
        setConversations((prev) =>
          prev.map((c) => (c.id === conversationId ? { ...c, title } : c)),
        );
      } else {
        await db.touchConversation(conversationId, { model: modelRef.current });
      }

      const payload = [...history, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));

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
            } else if (event.type === "error") {
              setError(event.message);
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
    },
    [conversations, finalize, messages, streaming],
  );

  const stopStream = useCallback(() => {
    const id = requestIdRef.current;
    if (!id) return;
    requestIdRef.current = null;
    setStreaming(false);
    void api.cancelStream(id);
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
