import type { Conversation } from "./types";

export type ChatFilter = "all" | "pinned" | `project:${string}`;

export function parseChatFilter(raw: string | null): ChatFilter {
  if (raw === "pinned") return "pinned";
  if (raw?.startsWith("project:")) return raw as ChatFilter;
  return "all";
}

export function filterChats(chats: Conversation[], filter: ChatFilter): Conversation[] {
  if (filter === "all") return chats;
  if (filter === "pinned") return chats.filter((chat) => chat.pinned === 1);
  const projectId = filter.slice("project:".length);
  return chats.filter((chat) => chat.project_id === projectId);
}

export function emptyFilterText(
  filter: ChatFilter,
  projectName: string | null,
): string | null {
  if (filter === "pinned") return "No pinned chats.";
  if (filter === "all") return null;
  return projectName ? `No chats in ${projectName} yet.` : "No chats in this project yet.";
}
