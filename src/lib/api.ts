import { invoke, Channel } from "@tauri-apps/api/core";
import type { FileCommand, StreamEvent } from "./types";
import { parseBackendCaps, type ModelCapabilities } from "./catalog";

export const SEARCH_KEY_ACCOUNT = "search:tavily";

export function setApiKey(connectionId: string, apiKey: string) {
  return invoke<void>("set_api_key", { connectionId, apiKey });
}

export function hasApiKey(connectionId: string) {
  return invoke<boolean>("has_api_key", { connectionId });
}

export function deleteApiKey(connectionId: string) {
  return invoke<void>("delete_api_key", { connectionId });
}

export interface SearchKeyInfo {
  index: number;
  hint: string;
}

export function searchKeyList() {
  return invoke<SearchKeyInfo[]>("search_key_list");
}

export function searchKeyTest(index: number) {
  return invoke<string>("search_key_test", { index });
}

export interface SearchKeyStat {
  requests: number;
  quota_hits: number;
}

export function searchKeyStats() {
  return invoke<SearchKeyStat[]>("search_key_stats");
}

export function searchEndpointTest(endpoint: string) {
  return invoke<string>("search_endpoint_test", { endpoint });
}

export function addSearchKey(apiKey: string) {
  return invoke<number>("search_key_add", { key: apiKey });
}

export function removeSearchKey(index: number) {
  return invoke<number>("search_key_remove", { index });
}

export function listModels(connectionId: string, connectionKind?: string) {
  return invoke<string[]>("list_models", { connectionId, connectionKind });
}

export async function listModelCaps(
  connectionId: string,
  connectionKind?: string,
): Promise<ModelCapabilities[]> {
  const raw: unknown = await invoke("list_model_caps", {
    connectionId,
    connectionKind,
  });
  return parseBackendCaps(raw);
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
  connectionId: string,
  model: string,
  userText: string,
  assistantText: string,
  connectionKind?: string,
) {
  return invoke<string>("suggest_title", {
    req: {
      connection_id: connectionId,
      model,
      user_text: userText,
      assistant_text: assistantText,
      connection_kind: connectionKind ?? null,
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

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: string } };

export interface ChatStreamArgs {
  requestId: string;
  connectionId: string;
  model: string;
  messages: { role: string; content: string | ChatContentPart[] }[];
  temperature?: number;
  enableTools?: boolean;
  maxIterations?: number;
  projectId?: string | null;
  conversationId?: string | null;
  reasoningEffort?: string | null;
  connectionKind?: string;
  searchBackend?: string | null;
  searchEndpoint?: string | null;
  visionFallbackModel?: string | null;
  visionFallbackConnection?: string | null;
  childSystem?: string | null;
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
      connection_id: args.connectionId,
      model: args.model,
      messages: args.messages,
      temperature: args.temperature,
      enable_tools: args.enableTools ?? false,
      max_iterations: args.maxIterations ?? null,
      project_id: args.projectId ?? null,
      conversation_id: args.conversationId ?? null,
      reasoning_effort: args.reasoningEffort ?? null,
          connection_kind: args.connectionKind ?? null,
          search_backend: args.searchBackend ?? null,
          search_endpoint: args.searchEndpoint ?? null,
          vision_fallback_model: args.visionFallbackModel ?? null,
          vision_fallback_connection: args.visionFallbackConnection ?? null,
          child_system: args.childSystem ?? null,
    },
    onEvent: channel,
  });
}

export function deleteSpill(conversationId: string) {
  return invoke<void>("delete_spill", { conversationId });
}

export function spillImageWrite(conversationId: string, name: string, dataUrl: string) {
  return invoke<string>("spill_image_write", { conversationId, name, dataUrl });
}

export interface SkillInfo {
  id: string;
  name: string;
  description: string;
}

export function skillIndex() {
  return invoke<SkillInfo[]>("skill_index");
}

export function skillRead(id: string) {
  return invoke<string>("skill_read", { id });
}

export interface McpServerRow {
  id: string;
  project_id: string | null;
  name: string;
  transport: string;
  cmd: string | null;
  url: string | null;
  allow_tools: string | null;
  deny_tools: string | null;
  ask_tools: string | null;
  approval_mode: string;
  timeout_ms: number | null;
  enabled: boolean;
}

export function mcpList(projectId: string | null) {
  return invoke<McpServerRow[]>("mcp_list", { projectId });
}

export interface McpToolInfo {
  name: string;
  description: string;
}

export interface McpProbe {
  id: string;
  status: string;
  error: string | null;
  tools: McpToolInfo[];
}

export function mcpToolList(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is string => typeof item === "string");
  } catch {
    return [];
  }
}

export function mcpAdd(
  projectId: string | null,
  name: string,
  transport: string,
  cmd: string | null,
  url: string | null,
) {
  return invoke<McpServerRow>("mcp_add", { projectId, name, transport, cmd, url });
}

export function mcpUpdate(
  id: string,
  name: string,
  transport: string,
  cmd: string | null,
  url: string | null,
) {
  return invoke<McpServerRow>("mcp_update", { id, name, transport, cmd, url });
}

export function mcpSetPolicy(id: string, ask: string[], allow: string[], deny: string[]) {
  return invoke<McpServerRow>("mcp_set_policy", { id, ask, allow, deny });
}

export function mcpSetApproval(id: string, mode: string) {
  return invoke<McpServerRow>("mcp_set_approval", { id, mode });
}

export function mcpStatus() {
  return invoke<McpProbe[]>("mcp_status");
}

export function mcpProbe(id: string) {
  return invoke<McpProbe>("mcp_probe", { id });
}

export function mcpRemove(id: string) {
  return invoke<void>("mcp_remove", { id });
}

export function mcpToggle(id: string, enabled: boolean) {
  return invoke<void>("mcp_toggle", { id, enabled });
}

export function listCommands(projectId: string | null) {
  return invoke<FileCommand[]>("list_commands_cmd", { projectId });
}

export function knowledgeSidecarWipe(projectId: string) {
  return invoke<void>("knowledge_sidecar_wipe", { projectId });
}

export function knowledgeSidecarDelete(projectId: string, sha256: string) {
  return invoke<void>("knowledge_sidecar_delete", { projectId, sha256 });
}

export function knowledgeSidecarWipeAll() {
  return invoke<void>("knowledge_sidecar_wipe_all");
}

interface IngestedDocument {
  sha256: string;
  path: string;
  chars: number;
}

export function attachmentIngest(name: string, mime: string, data: string, sha256: string) {
  return invoke<IngestedDocument>("attachment_ingest", { name, mime, data, sha256 });
}

export function documentRead(sha256: string, projectId: string | null) {
  return invoke<string>("document_read", { sha256, projectId });
}

export function documentsWipeUnreferenced(shas: string[]) {
  return invoke<number>("documents_wipe_unreferenced", { shas });
}

export function documentsWipeAll() {
  return invoke<void>("documents_wipe_all");
}

export function summarize(
  connectionId: string,
  model: string,
  text: string,
  connectionKind?: string,
) {
  return invoke<string>("summarize", {
    req: {
      connection_id: connectionId,
      model,
      text,
      connection_kind: connectionKind ?? null,
    },
  });
}

export type SandboxState = "not_installed" | "daemon_stopped" | "no_image" | "ready";

export type SandboxStatus = {
  state: SandboxState;
  enabled: boolean;
  docker: string | null;
  image: string | null;
  image_size: number | null;
  project_root: string | null;
  packages: string[];
  cpus: number;
  memory_mb: number;
  detail: string | null;
};

export function sandboxStatus() {
  return invoke<SandboxStatus>("sandbox_status");
}

export function sandboxEnable(packages: string[], projectRoot?: string | null) {
  return invoke<SandboxStatus>("sandbox_enable", { packages, projectRoot: projectRoot ?? null });
}

export function sandboxDisable() {
  return invoke<SandboxStatus>("sandbox_disable");
}

export function sandboxRebuild() {
  return invoke<SandboxStatus>("sandbox_rebuild");
}

export function sandboxSetLimits(cpus: number, memoryMb: number) {
  return invoke<SandboxStatus>("sandbox_set_limits", { cpus, memoryMb });
}

export type VoiceFile = {
  name: string;
  bytes: number;
  expected: number;
};

export type VoiceStatus = {
  enabled: boolean;
  ready: boolean;
  model_dir: string;
  bytes: number;
  expected: number;
  provider: string | null;
  model: string | null;
  files: VoiceFile[];
};

export type VoiceProgress = {
  file: string;
  done: number;
  total: number;
};

type Transcript = {
  text: string;
  ms: number;
};

export function voiceStatus() {
  return invoke<VoiceStatus>("voice_status");
}

export function voiceEnable() {
  return invoke<VoiceStatus>("voice_enable");
}

export function voiceDisable() {
  return invoke<VoiceStatus>("voice_disable");
}

export function voiceSetProvider(provider: string | null, model: string | null) {
  return invoke<VoiceStatus>("voice_set_provider", { provider, model });
}

export function audioTranscribe(pcm: number[], sampleRate: number) {
  return invoke<Transcript>("audio_transcribe", { pcm, sampleRate });
}
