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

export const toolLogEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  summary: z.string(),
  status: z.enum(["running", "ok", "err"]),
  preview: z.string().nullable(),
});
export type ToolLogEntry = z.infer<typeof toolLogEntrySchema>;

export const declaredArtifactSchema = z.object({
  title: z.string(),
  lang: z.string(),
  code: z.string(),
});
export type DeclaredArtifact = z.infer<typeof declaredArtifactSchema>;

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
  tool_log: z.string().nullish(),
  artifacts: z.string().nullish(),
  model: z.string().nullish(),
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
  summary: z.string().nullable(),
  summary_through: z.number().nullable(),
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

export const searchQuerySchema = z.object({
  q: z.string().trim().min(1, "Search cannot be empty").max(200),
  projectId: z.string().nullable().optional(),
  pinnedOnly: z.boolean().optional(),
  from: z.number().nullable().optional(),
  to: z.number().nullable().optional(),
  limit: z.number().int().min(1).max(50).optional(),
});
export type SearchQuery = z.infer<typeof searchQuerySchema>;

export const tagSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1, "Tag cannot be empty")
  .max(32, "Tag too long")
  .regex(/^[a-z0-9-]+$/, "Letters, numbers and dashes only");
export type Tag = z.infer<typeof tagSchema>;

export interface SearchHit {
  conversationId: string;
  messageId: string | null;
  snippet: string;
}

const usageSchema = z.object({
  prompt: z.number(),
  completion: z.number(),
  total: z.number(),
});

const exportMessageSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  childrenIds: z.array(z.string()),
  role: roleSchema,
  content: z.string(),
  reasoning: z.string().nullable(),
  thinkingMs: z.number().nullable(),
  usage: usageSchema.nullable(),
  finishReason: z.string().nullable(),
  toolLog: z.array(toolLogEntrySchema),
  artifacts: z.array(declaredArtifactSchema),
  model: z.string().nullable().optional(),
  createdAt: z.number(),
});

export const chatExportSchema = z
  .object({
    app: z.literal("myagent"),
    format: z.number().int().min(1).max(1),
    exportedAt: z.string(),
    chat: z.object({
      title: z.string(),
      model: z.string().nullable(),
      pinned: z.boolean(),
      projectId: z.string().nullable(),
      summary: z.string().nullable(),
    }),
    messages: z.array(exportMessageSchema).min(1).max(2000),
  })
  .strict();
export type ChatExport = z.infer<typeof chatExportSchema>;

export const memoryDraftSchema = z.object({
  content: z.string().min(1, "Memory cannot be empty").max(2000),
  kind: memoryKindSchema,
});
export type MemoryDraft = z.infer<typeof memoryDraftSchema>;

const streamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("delta"), text: z.string() }),
  z.object({ type: z.literal("done") }),
  z.object({ type: z.literal("reasoning"), text: z.string() }),
  z.object({ type: z.literal("retract"), chars: z.number() }),
  z.object({
    type: z.literal("usage"),
    prompt_tokens: z.number(),
    completion_tokens: z.number(),
    total_tokens: z.number(),
  }),
  z.object({ type: z.literal("finish"), reason: z.string().nullable() }),
  z.object({ type: z.literal("retrying"), attempt: z.number(), max: z.number() }),
  z.object({
    type: z.literal("approval_asked"),
    id: z.string(),
    tool: z.string(),
    command: z.string(),
    cwd: z.string(),
  }),
  z.object({
    type: z.literal("question_asked"),
    id: z.string(),
    question: z.string(),
    options: z.array(z.string()),
    allow_custom: z.boolean(),
  }),
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
