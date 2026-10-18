import {
  messageAttachmentsSchema,
  type MessageAttachment,
  type MessageDocAttachment,
  type MessageImageAttachment,
} from "./types";

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

export function parseImageAttachments(raw: unknown): MessageImageAttachment[] {
  return parseMessageAttachments(raw).filter(
    (attachment): attachment is MessageImageAttachment => attachment.kind === "image",
  );
}

export function parseDocAttachments(raw: unknown): MessageDocAttachment[] {
  return parseMessageAttachments(raw).filter(
    (attachment): attachment is MessageDocAttachment => attachment.kind === "doc",
  );
}
