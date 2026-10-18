import {
  messageAttachmentSchema,
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
  if (!Array.isArray(value)) {
    console.warn("parseMessageAttachments: attachments are not a list, dropping");
    return [];
  }
  const attachments: MessageAttachment[] = [];
  for (const entry of value) {
    const parsed = messageAttachmentSchema.safeParse(entry);
    if (parsed.success) attachments.push(parsed.data);
    else console.warn("parseMessageAttachments: dropped an unreadable attachment");
  }
  return attachments;
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
