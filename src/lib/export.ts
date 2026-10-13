import type { Message } from "./types";

export function conversationToMarkdown(title: string, messages: Message[]): string {
  const lines = [`# ${title}`, ""];
  for (const message of messages) {
    if (!message.content) continue;
    lines.push(message.role === "user" ? "## You" : "## Assistant", "", message.content, "");
  }
  return lines.join("\n");
}

export function safeFilename(title: string): string {
  const cleaned = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${cleaned || "chat"}.md`;
}
