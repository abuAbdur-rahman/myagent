import * as api from "./api";

const MAX_EVENTS = 300;

const events: string[] = [];

const REDACTIONS: Array<[RegExp, string]> = [
  [/\bsk-[A-Za-z0-9_-]{6,}/g, "sk-[redacted]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]"],
  [/\b(api[_-]?key|token|access[_-]?token)=([^&\s"'<>]+)/gi, "$1=[redacted]"],
  [/("(?:api[_-]?key|apiKey|token|secret|password)"\s*:\s*")[^"]*(")/gi, "$1[redacted]$2"],
];

function redact(text: string): string {
  return REDACTIONS.reduce(
    (out, [pattern, replacement]) => out.replace(pattern, replacement),
    text,
  );
}

function describe(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function logEvent(
  kind: "error" | "window.error" | "unhandledrejection",
  detail?: unknown,
): void {
  const suffix = detail === undefined ? "" : ` ${describe(detail)}`;
  const line = redact(`${new Date().toISOString()} ${kind}${suffix}`).slice(0, 2000);
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
  const lines = [
    `MyAgent ${extra.version ?? "unknown"}`,
    `OS ${typeof navigator === "undefined" ? "unknown" : navigator.userAgent}`,
    `Locale ${typeof navigator === "undefined" ? "unknown" : navigator.language}`,
    `Connection ${extra.connection ?? "none"}`,
    `Model ${extra.model ?? "none"}`,
    `Theme ${extra.theme ?? "unknown"}`,
    "",
    "Recent events:",
    ...recentLog().slice(-80),
  ];
  return redact(lines.join("\n"));
}
