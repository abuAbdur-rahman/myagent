// @vitest-environment jsdom
import { act, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StreamEvent } from "./types";

vi.mock("./db", () => {
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

vi.mock("./api", () => ({
  chatStream: vi.fn(),
  formatInvokeError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
  hasApiKey: async () => true,
  listModels: async () => [],
  listModelCaps: async () => [],
  listCommands: async () => [],
  skillIndex: async () => [],
  cancelStream: async () => undefined,
  approvalReply: async () => undefined,
  questionAnswer: async () => undefined,
  deleteApiKey: async () => undefined,
  deleteSpill: async () => undefined,
  spillImageWrite: async () => "",
  suggestTitle: async () => null,
  summarize: async () => "",
}));

import * as api from "./api";
import { AppProvider, useApp } from "./store";

type App = ReturnType<typeof useApp>;

let app: App | null = null;

function Probe() {
  app = useApp();
  return null;
}

const events: StreamEvent[] = [
  { type: "delta", text: "Hello" },
  { type: "tool_start", id: "t1", name: "web_search", summary: "Search: rust" },
  { type: "tool_result", id: "t1", ok: true, preview: "3 results" },
  { type: "tool_start", id: "d1", name: "delegate_task", summary: "Research rust" },
  { type: "subagent", parent: "d1", event: { type: "delta", text: "child says hi" } },
  {
    type: "subagent",
    parent: "d1",
    event: { type: "tool_start", id: "c1", name: "web_search", summary: "child search" },
  },
  { type: "tool_result", id: "d1", ok: true, preview: "child summary" },
  { type: "delta", text: " world" },
  { type: "usage", prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
  { type: "finish", reason: "stop" },
];

beforeEach(() => {
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
    for (const event of events) onEvent(event);
  });
});

describe("streamTurn", () => {
  it("streams deltas, settles the tool log, and persists the turn", async () => {
    render(createElement(AppProvider, null, createElement(Probe)));
    await waitFor(() => expect(app?.ready).toBe(true));

    await act(async () => {
      await app?.sendMessage("hello");
    });

    expect(api.chatStream).toHaveBeenCalledTimes(1);
    const [args] = vi.mocked(api.chatStream).mock.calls[0];
    expect(args.model).toBe("test/model");
    expect(args.messages[args.messages.length - 1]).toEqual({ role: "user", content: "hello" });

    const assistant = app?.messages[app.messages.length - 1];
    expect(assistant?.role).toBe("assistant");
    expect(assistant?.content).toBe("Hello world");
    expect(assistant?.total_tokens).toBe(12);
    expect(assistant?.finish_reason).toBe("stop");
    expect(app?.streaming).toBe(false);

    const log = JSON.parse(assistant?.tool_log ?? "[]") as {
      id: string;
      status: string;
      preview: string | null;
    }[];
    expect(log).toEqual([
      { id: "t1", name: "web_search", summary: "Search: rust", status: "ok", preview: "3 results" },
      {
        id: "d1",
        name: "delegate_task",
        summary: "Research rust",
        status: "ok",
        preview:
          "child says hi\n-> web_search: child search\n\n--- summary ---\nchild summary",
      },
    ]);
  });

  it("keeps the failure visible and allows a retry when the stream throws", async () => {
    vi.mocked(api.chatStream).mockRejectedValue(new Error("network down"));
    render(createElement(AppProvider, null, createElement(Probe)));
    await waitFor(() => expect(app?.ready).toBe(true));

    await act(async () => {
      await app?.sendMessage("hello");
    });

    expect(app?.error).toContain("network down");
    expect(app?.streaming).toBe(false);
    expect(app?.canRetry).toBe(true);
  });
});
