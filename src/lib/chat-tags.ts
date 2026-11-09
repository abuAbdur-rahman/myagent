import type { Conversation } from "./types";

export function filterChatsByTag(
  conversations: Conversation[],
  tagFilter: string | null,
  tagMap: Map<string, string[]>,
): Conversation[] {
  const listed = conversations.filter((conversation) => !conversation.temporary);
  if (!tagFilter) return listed;
  return listed.filter((conversation) => {
    const tags = tagMap.get(conversation.id);
    return tags?.includes(tagFilter) ?? false;
  });
}
