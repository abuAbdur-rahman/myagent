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
