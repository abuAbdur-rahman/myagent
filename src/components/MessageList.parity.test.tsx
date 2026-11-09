// @vitest-environment jsdom
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamEvent } from "../lib/types";

vi.mock("../lib/db", () => {
  let seq = 0;
  const conversation = {
    id: "conv-1",
    title: "New chat",
    connection_id: "conn-1",
    project_id: null,
    pinned: 0,
    compacted: 0,
    model: "test/model",
    summary: null,
    summary_through: null,
    created_at: 1,
    updated_at: 1,
  };
  const message = (role: string, content: string) => ({
    id: `m-${++seq}`,
    conversation_id: conversation.id,
    role,
    content,
    created_at: seq,
  });
  return {
    listConnections: async () => [
      {
        id: "conn-1",
        name: "Test",
        base_url: "https://example.com/v1",
        kind: "openrouter",
        default_model: "test/model",
        created_at: 1,
      },
    ],
    listProjects: async () => [],
    listConversations: async () => [],
    listMemories: async () => [],
    listTodos: async () => [],
    listMessages: async () => [],
    listHiddenModels: async () => [],
    parseDeclaredArtifacts: () => [],
    parseToolLog: () => [],
    createConversation: async () => conversation,
    addMessage: async (_conversationId: string, role: string, content: string) =>
      message(role, content),
    updateMessage: async () => undefined,
    updateMessageMeta: async () => undefined,
    updateMessageAttachments: async () => undefined,
    touchConversation: async () => undefined,
    deleteMessage: async () => undefined,
    setConversationCompacted: async () => undefined,
    setConversationSummary: async () => undefined,
    createConnection: async () => undefined,
    updateConnection: async () => undefined,
    deleteConnection: async () => undefined,
    createProject: async () => undefined,
    updateProject: async () => undefined,
    deleteProject: async () => undefined,
    createMemory: async () => undefined,
    updateMemory: async () => undefined,
    deleteMemory: async () => undefined,
    deleteConversation: async () => undefined,
    clearConversation: async () => undefined,
    branchConversation: async () => undefined,
    truncateConversation: async () => undefined,
    toggleConversationPin: async () => undefined,
    hideModel: async () => undefined,
    unhideModel: async () => undefined,
    hideAllModels: async () => undefined,
    unhideAllModels: async () => undefined,
  };
});

vi.mock("../lib/api", () => ({
  chatStream: vi.fn(),
  formatInvokeError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  classifyStreamError: () => ({ cls: "unknown", hint: "" }),
  hasApiKey: async () => true,
  listModels: async () => [],
  listModelCaps: async () => [],
  listCommands: async () => [],
  skillIndex: async () => [],
  cancelStream: vi.fn(async () => undefined),
  approvalReply: async () => undefined,
  questionAnswer: async () => undefined,
  deleteApiKey: async () => undefined,
  deleteSpill: async () => undefined,
  spillImageWrite: async () => "",
  suggestTitle: async () => null,
  summarize: async () => "",
  todoFinish: async () => undefined,
}));

import * as api from "../lib/api";
import { AppProvider, useApp } from "../lib/store";
import { MessageList } from "./MessageList";

type App = ReturnType<typeof useApp>;

let app: App | null = null;

function Probe() {
  app = useApp();
  return null;
}

const MARKDOWN = "# Heading\n\n**bold** and `code`\n\n- one\n- two";

beforeEach(() => {
  app = null;
  vi.clearAllMocks();
  localStorage.clear();
  localStorage.setItem("model", "test/model");
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
  vi.mocked(api.chatStream).mockImplementation(async (_args, onEvent) => {
    const events: StreamEvent[] = [
      { type: "delta", text: MARKDOWN },
      { type: "finish", reason: "stop" },
    ];
    for (const event of events) onEvent(event);
  });
});

afterEach(cleanup);

describe("MessageList markdown parity", () => {
  it("renders the same markdown for the user and assistant bubbles", async () => {
    render(createElement(AppProvider, null, createElement(MessageList), createElement(Probe)));
    await waitFor(() => expect(app?.ready).toBe(true), { timeout: 15000 });

    await act(async () => {
      await app?.sendMessage(MARKDOWN);
    });

    await waitFor(() => expect(document.querySelectorAll(".markdown")).toHaveLength(2), {
      timeout: 15000,
    });

    const [user, assistant] = Array.from(document.querySelectorAll(".markdown"));
    expect(user.innerHTML).toContain("<h1");
    expect(assistant.innerHTML).toBe(user.innerHTML);
  }, 30000);
});
