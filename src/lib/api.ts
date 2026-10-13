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
    },
    onEvent: channel,
  });
}
