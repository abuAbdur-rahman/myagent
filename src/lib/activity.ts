import type { Message } from "./types";

export type ActivityState = "thinking" | "writing";
export type PillState = ActivityState | "compacting" | "recording" | "transcribing";
export type VoicePhase = "idle" | "recording" | "transcribing";

export function activityState(messages: Message[], streaming: boolean): ActivityState | null {
  if (!streaming) return null;
  const last = messages[messages.length - 1];
  const writing = last?.role === "assistant" && last.content.trim().length > 0;
  return writing ? "writing" : "thinking";
}

export function pillState(input: {
  messages: Message[];
  streaming: boolean;
  compacting: boolean;
  voice: VoicePhase;
}): PillState | null {
  if (input.voice === "recording") return "recording";
  if (input.voice === "transcribing") return "transcribing";
  if (input.compacting) return "compacting";
  return activityState(input.messages, input.streaming);
}
