import type { Message } from "./types";

export type ActivityState = "thinking" | "writing";

export function activityState(messages: Message[], streaming: boolean): ActivityState | null {
  if (!streaming) return null;
  const last = messages[messages.length - 1];
  const writing = last?.role === "assistant" && last.content.trim().length > 0;
  return writing ? "writing" : "thinking";
}
