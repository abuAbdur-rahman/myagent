import { z } from "zod";

export const providerKindSchema = z.enum(["openrouter", "custom"]);
export type ProviderKind = z.infer<typeof providerKindSchema>;

export const connectionSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(64),
  base_url: z.string().url(),
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

export const roleSchema = z.enum(["system", "user", "assistant"]);
export type Role = z.infer<typeof roleSchema>;

export const messageSchema = z.object({
  id: z.string(),
  conversation_id: z.string(),
  role: roleSchema,
  content: z.string(),
  created_at: z.number(),
});
export type Message = z.infer<typeof messageSchema>;

export const conversationSchema = z.object({
  id: z.string(),
  title: z.string(),
  connection_id: z.string().nullable(),
  model: z.string().nullable(),
  created_at: z.number(),
  updated_at: z.number(),
});
export type Conversation = z.infer<typeof conversationSchema>;

export const streamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("delta"), text: z.string() }),
  z.object({ type: z.literal("done") }),
  z.object({ type: z.literal("error"), message: z.string() }),
]);
export type StreamEvent = z.infer<typeof streamEventSchema>;

export const DEFAULT_BASE_URLS: Record<ProviderKind, string> = {
  openrouter: "https://openrouter.ai/api/v1",
  custom: "https://api.openai.com/v1",
};
