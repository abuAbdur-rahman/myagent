import { z } from "zod";

const providerKindSchema = z.enum(["openrouter", "agentrouter", "custom"]);
export type ProviderKind = z.infer<typeof providerKindSchema>;

const connectionSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(64),
  base_url: z
    .string()
    .url()
    .refine((url) => /^https?:\/\//i.test(url), "Only http(s) URLs are allowed"),
  kind: providerKindSchema,
  default_model: z.string().nullable(),
  created_at: z.number(),
});
export type Connection = z.infer<typeof connectionSchema>;

export const connectionInputSchema = connectionSchema.omit({
  id: true,
  created_at: true,
});
export type ConnectionInput = z.infer<typeof connectionInputSchema>;

const roleSchema = z.enum(["system", "user", "assistant"]);
export type Role = z.infer<typeof roleSchema>;

const messageSchema = z.object({
  id: z.string(),
  conversation_id: z.string(),
  role: roleSchema,
  content: z.string(),
  reasoning: z.string().nullish(),
  thinking_ms: z.number().nullish(),
  prompt_tokens: z.number().nullish(),
  completion_tokens: z.number().nullish(),
  total_tokens: z.number().nullish(),
  finish_reason: z.string().nullish(),
  created_at: z.number(),
});
export type Message = z.infer<typeof messageSchema>;

const conversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  connection_id: z.string().nullable(),
  project_id: z.string().nullable(),
  pinned: z.number(),
  compacted: z.number(),
  model: z.string().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
});
export type Conversation = z.infer<typeof conversationSchema>;

const projectSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(80),
  description: z.string().max(2000),
  instructions: z.string().max(8000),
  created_at: z.number(),
  updated_at: z.number(),
});
export type Project = z.infer<typeof projectSchema>;

export const projectInputSchema = projectSchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export type ProjectInput = z.infer<typeof projectInputSchema>;

const memoryScopeSchema = z.enum(["global", "project"]);
export type MemoryScope = z.infer<typeof memoryScopeSchema>;

const memoryKindSchema = z.enum(["fact", "preference", "summary", "note"]);
export type MemoryKind = z.infer<typeof memoryKindSchema>;

const memorySchema = z.object({
  id: z.string(),
  scope: memoryScopeSchema,
  project_id: z.string().nullable(),
  kind: memoryKindSchema,
  content: z.string().min(1).max(2000),
  created_at: z.number(),
  updated_at: z.number(),
});
export type Memory = z.infer<typeof memorySchema>;

export const memoryInputSchema = memorySchema.omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export type MemoryInput = z.infer<typeof memoryInputSchema>;

export const MEMORY_KINDS: MemoryKind[] = [...memoryKindSchema.options];

export const memoryDraftSchema = z.object({
  content: z.string().min(1, "Memory cannot be empty").max(2000),
  kind: memoryKindSchema,
});
export type MemoryDraft = z.infer<typeof memoryDraftSchema>;

const streamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("delta"), text: z.string() }),
  z.object({ type: z.literal("done") }),
  z.object({ type: z.literal("reasoning"), text: z.string() }),
  z.object({
    type: z.literal("usage"),
    prompt_tokens: z.number(),
    completion_tokens: z.number(),
    total_tokens: z.number(),
  }),
  z.object({ type: z.literal("finish"), reason: z.string().nullable() }),
  z.object({ type: z.literal("tool_start"), id: z.string(), name: z.string(), summary: z.string() }),
  z.object({ type: z.literal("tool_result"), id: z.string(), ok: z.boolean(), preview: z.string() }),
  z.object({ type: z.literal("artifact"), title: z.string(), lang: z.string(), code: z.string() }),
]);
export type StreamEvent = z.infer<typeof streamEventSchema>;

export const DEFAULT_BASE_URLS: Record<ProviderKind, string> = {
  openrouter: "https://openrouter.ai/api/v1",
  agentrouter: "https://agentrouter.org/v1",
  custom: "https://api.openai.com/v1",
};
