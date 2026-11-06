import type { Message } from "./types";

export type ActivityState = "thinking" | "writing";
export type PillState =
  | ActivityState
  | "compacting"
  | "starting"
  | "recording"
  | "transcribing";
export type VoicePhase = "idle" | "starting" | "recording" | "transcribing";

export type PillPlacement = "center" | "inline";

export function pillPlacement(hasMessages: boolean): PillPlacement {
  return hasMessages ? "inline" : "center";
}

const TOOL_LABELS: Record<string, string> = {
  web_search: "Searching the web",
  web_fetch: "Reading a page",
  research_run: "Researching",
  run_powershell: "Working in PowerShell",
  sandbox_run: "Working in the sandbox",
  sandbox_read: "Reading a file",
  sandbox_glob: "Listing files",
  sandbox_grep: "Searching files",
  sandbox_write: "Writing a file",
  sandbox_edit: "Editing a file",
  skill: "Loading a skill",
  read_document: "Reading a document",
  describe_image: "Looking at an image",
  delegate_task: "Delegating a task",
  save_artifact: "Saving an artifact",
  todo_write: "Updating the checklist",
  todo_set: "Updating the checklist",
  ask_user: "Waiting for your answer",
  get_time: "Checking the time",
  remember: "Saving a memory",
  memory_search: "Searching memory",
};

export function toolActivityLabel(name: string | null): string | null {
  if (!name) return null;
  const known = TOOL_LABELS[name];
  if (known) return known;
  const readable = name
    .replace(/^mcp__/, "")
    .replace(/__/g, " / ")
    .replace(/_/g, " ")
    .trim();
  return readable ? `Working: ${readable}` : "Working";
}

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
  if (input.voice === "starting") return "starting";
  if (input.voice === "recording") return "recording";
  if (input.voice === "transcribing") return "transcribing";
  if (input.compacting) return "compacting";
  return activityState(input.messages, input.streaming);
}
