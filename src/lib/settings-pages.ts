export const SETTINGS_PAGES = [
  { id: "general", label: "General" },
  { id: "appearance", label: "Appearance" },
  { id: "providers", label: "Providers" },
  { id: "models", label: "Models" },
  { id: "search", label: "Search" },
  { id: "mcp", label: "MCP" },
  { id: "sandbox", label: "Sandbox" },
  { id: "voice", label: "Voice" },
  { id: "audit", label: "Audit" },
  { id: "memory", label: "Memory" },
  { id: "data", label: "Data" },
  { id: "shortcuts", label: "Shortcuts" },
  { id: "changelog", label: "Changelog" },
  { id: "about", label: "About" },
] as const;

export type SettingsPageId = (typeof SETTINGS_PAGES)[number]["id"];

export function resolveSettingsPage(value: string | null): SettingsPageId {
  const match = SETTINGS_PAGES.find((page) => page.id === value);
  return match ? match.id : "general";
}

export const SETTINGS_SUBTITLES: Record<SettingsPageId, string> = {
  general: "How a chat starts, and how much context is sent with every message.",
  appearance: "Theme, accent color, and how dense the interface feels.",
  providers: "API keys and base URLs. Keys stay in Windows Credential Manager.",
  models: "What the active model can do, and which model answers first.",
  search: "Where web results come from, and which keys get spent.",
  mcp: "External tool servers, and what each tool may do without asking.",
  sandbox: "Run commands in Docker instead of the host shell.",
  voice: "Microphone, transcription model, and where the audio goes.",
  audit: "Every tool decision, newest first, with the reason behind it.",
  memory: "Notes sent with every chat. Global lives here, project memory lives with the project.",
  data: "What this app has stored, and how to take it or remove it.",
  shortcuts: "Keys that work anywhere in the app.",
  changelog: "Every release, newest first.",
  about: "Version, updates, and where the source lives.",
};
