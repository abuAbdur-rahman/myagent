import type { Conversation } from "./types";

export interface ChatGroup {
  name: string;
  items: Conversation[];
}

const DAY = 86_400_000;

export function groupChats(chats: Conversation[], now = Date.now()): ChatGroup[] {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const t0 = startOfToday.getTime();

  const groups: Record<string, Conversation[]> = {
    Pinned: [],
    Today: [],
    Yesterday: [],
    "Previous 7 days": [],
    Older: [],
  };

  [...chats]
    .sort((a, b) => b.updated_at - a.updated_at)
    .forEach((chat) => {
      if (chat.pinned === 1) {
        groups.Pinned.push(chat);
      } else if (chat.updated_at >= t0) {
        groups.Today.push(chat);
      } else if (chat.updated_at >= t0 - DAY) {
        groups.Yesterday.push(chat);
      } else if (chat.updated_at >= t0 - 7 * DAY) {
        groups["Previous 7 days"].push(chat);
      } else {
        groups.Older.push(chat);
      }
    });

  return Object.entries(groups)
    .filter(([, items]) => items.length > 0)
    .map(([name, items]) => ({ name, items }));
}

export function arrangeChats(
  chats: Conversation[],
  groupByDate: boolean,
  now = Date.now(),
): ChatGroup[] {
  if (groupByDate) return groupChats(chats, now);

  const sorted = [...chats].sort((a, b) => b.updated_at - a.updated_at);
  const pinned = sorted.filter((chat) => chat.pinned === 1);
  const rest = sorted.filter((chat) => chat.pinned !== 1);

  const groups: ChatGroup[] = [];
  if (pinned.length > 0) groups.push({ name: "Pinned", items: pinned });
  if (rest.length > 0) groups.push({ name: "Chats", items: rest });
  return groups;
}

const PROJECT_COLORS = ["#c96442", "#0067c0", "#0f7b0f", "#7a42d6", "#c239b3"];

export function projectColor(projectId: string): string {
  let hash = 0;
  for (let i = 0; i < projectId.length; i++) {
    hash = (hash * 31 + projectId.charCodeAt(i)) | 0;
  }
  return PROJECT_COLORS[Math.abs(hash) % PROJECT_COLORS.length];
}

export function timeAgo(timestamp: number, now = Date.now()): string {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const startOfTimestamp = new Date(timestamp);
  startOfTimestamp.setHours(0, 0, 0, 0);
  const days = Math.round((startOfToday.getTime() - startOfTimestamp.getTime()) / DAY);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
