import * as api from "./api";

const MAX_EVENTS = 300;

const events: string[] = [];

function describe(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function logEvent(message: string, detail?: unknown): void {
  const suffix = detail === undefined ? "" : ` ${describe(detail)}`;
  const line = `${new Date().toISOString()} ${message}${suffix}`.slice(0, 2000);
  events.push(line);
  if (events.length > MAX_EVENTS) events.shift();
  if ("debugLogAppend" in api && typeof api.debugLogAppend === "function") {
    void api.debugLogAppend(line).catch(() => undefined);
  }
}

function recentLog(): string[] {
  return [...events];
}

export function debugReport(extra: Record<string, string>): string {
  return [
    `MyAgent ${extra.version ?? "unknown"}`,
    `OS ${typeof navigator === "undefined" ? "unknown" : navigator.userAgent}`,
    `Locale ${typeof navigator === "undefined" ? "unknown" : navigator.language}`,
    `Connection ${extra.connection ?? "none"}`,
    `Model ${extra.model ?? "none"}`,
    `Theme ${extra.theme ?? "unknown"}`,
    "",
    "Recent events:",
    ...(recentLog().slice(-80) || []),
  ].join("\n");
}
