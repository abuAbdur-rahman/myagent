import { messageAttachmentsSchema, type MessageAttachment } from "./types";

export function parseMessageAttachments(raw: unknown): MessageAttachment[] {
  if (typeof raw !== "string" || raw.length === 0) return [];
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    console.warn("parseMessageAttachments: invalid JSON, dropping attachments");
    return [];
  }
  const parsed = messageAttachmentsSchema.safeParse(value);
  if (!parsed.success) {
    console.warn("parseMessageAttachments: invalid attachments, dropping");
    return [];
  }
  return parsed.data;
}
