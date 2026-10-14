import { invoke, Channel } from "@tauri-apps/api/core";
import type { StreamEvent } from "./types";

export function setApiKey(connectionId: string, apiKey: string) {
  return invoke<void>("set_api_key", { connectionId, apiKey });
}

export function hasApiKey(connectionId: string) {
  return invoke<boolean>("has_api_key", { connectionId });
}

export function deleteApiKey(connectionId: string) {
  return invoke<void>("delete_api_key", { connectionId });
}

export function listModels(baseUrl: string, connectionId: string) {
  return invoke<string[]>("list_models", { baseUrl, connectionId });
}

export function approvalReply(id: string, reply: "once" | "always" | "deny") {
  return invoke<void>("approval_reply", { req: { id, reply } });
}

export function questionAnswer(id: string, answer: string) {
  return invoke<void>("question_answer", { req: { id, answer } });
}

export function cancelStream(requestId: string) {
  return invoke<void>("cancel_stream", { requestId });
}

export function suggestTitle(
  baseUrl: string,
  connectionId: string,
  model: string,
  userText: string,
  assistantText: string,
) {
  return invoke<string>("suggest_title", {
    req: {
      base_url: baseUrl,
      connection_id: connectionId,
      model,
      user_text: userText,
      assistant_text: assistantText,
    },
  });
}

export type StreamErrorClass = "key" | "model" | "rate-limit" | "network" | "provider";

export function classifyStreamError(message: string): { cls: StreamErrorClass; hint: string } {
  const lower = message.toLowerCase();
  if (
    lower.includes("401") ||
    lower.includes("unauthor") ||
    lower.includes("invalid api key") ||
    lower.includes("incorrect api key") ||
    lower.includes("invalid_api_key")
  ) {
    return {
      cls: "key",
      hint: "API key rejected. Check the key in Settings → Providers, then retry.",
    };
  }
  if (
    lower.includes("404") ||
    lower.includes("model not found") ||
    lower.includes("no such model") ||
    lower.includes("does not exist")
  ) {
    return {
      cls: "model",
      hint: "Model not found — it may be renamed or retired. Pick another model, then retry.",
    };
  }
  if (
    lower.includes("429") ||
    lower.includes("rate limit") ||
    lower.includes("rate_limit") ||
    lower.includes("too many requests") ||
    lower.includes("quota")
  ) {
    return {
      cls: "rate-limit",
      hint: "Rate limited. Wait a bit, then retry — automatic backoff lands in 0.1.4.",
    };
  }
  if (
    lower.includes("network") ||
    lower.includes("failed to fetch") ||
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    lower.includes("dns") ||
    lower.includes("connection refused") ||
    lower.includes("offline")
  ) {
    return {
      cls: "network",
      hint: "Network error — the request never reached the provider. Check your connection, then retry.",
    };
  }
  return { cls: "provider", hint: "Provider error. Raw message below." };
}

export function formatInvokeError(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message.trim() || "Something went wrong.";
  if (error && typeof error === "object") {
    const record = error as Record<string, unknown>;
    if (typeof record.message === "string" && record.message.trim()) {
      return record.message;
    }
    const keys = Object.keys(record);
    if (keys.length === 1) {
      const key = keys[0];
      const label = key.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
      const value = record[key];
      if (typeof value === "string" && value.trim()) return `${label}: ${value}`;
      return label || "Something went wrong.";
    }
    try {
      const text = JSON.stringify(record);
      return text.length > 300 ? `${text.slice(0, 300)}…` : text;
    } catch {
      return "Something went wrong.";
    }
  }
  return "Something went wrong.";
}

export interface ChatStreamArgs {
  requestId: string;
  baseUrl: string;
  connectionId: string;
  model: string;
  messages: { role: string; content: string }[];
  temperature?: number;
  enableTools?: boolean;
  maxIterations?: number;
  projectId?: string | null;
  reasoningEffort?: string | null;
}

export async function chatStream(
  args: ChatStreamArgs,
  onEvent: (event: StreamEvent) => void,
): Promise<void> {
  const channel = new Channel<StreamEvent>();
  channel.onmessage = onEvent;
  await invoke("chat_stream", {
    req: {
      request_id: args.requestId,
      base_url: args.baseUrl,
      connection_id: args.connectionId,
      model: args.model,
      messages: args.messages,
      temperature: args.temperature,
      enable_tools: args.enableTools ?? false,
      max_iterations: args.maxIterations ?? null,
      project_id: args.projectId ?? null,
      reasoning_effort: args.reasoningEffort ?? null,
    },
    onEvent: channel,
  });
}
