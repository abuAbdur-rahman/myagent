import * as api from "./api";

const MAX_EVENTS = 300;

const events: string[] = [];

const KEY =
  "api[_-]?key|apikey|access[_-]?token|refresh[_-]?token|id[_-]?token|client[_-]?secret|private[_-]?key|secret[_-]?access[_-]?key|token|secret|password|passwd|pwd|credential|authorization";
const KEY_NAME = `[A-Za-z0-9_-]*(?:${KEY})`;

const REDACTIONS: Array<[RegExp, string]> = [
  [/\bsk-[A-Za-z0-9_-]{6,}/g, "sk-[redacted]"],
  [/\bgh[opsu]_[A-Za-z0-9]{12,}/g, "gh_[redacted]"],
  [/\bgithub_pat_[A-Za-z0-9_]{12,}/g, "github_pat_[redacted]"],
  [/\bglpat-[A-Za-z0-9_-]{12,}/g, "glpat-[redacted]"],
  [/\bxox[bpoas]-[A-Za-z0-9-]{8,}/g, "xox-[redacted]"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "AKIA[redacted]"],
  [/\bAIza[0-9A-Za-z_-]{30,}/g, "AIza[redacted]"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]"],
  [
    /((?:authorization\s*[:=]\s*)basic\s+)[A-Za-z0-9+/=]{8,}/gi,
    "$1[redacted]",
  ],
  [
    new RegExp(
      `((?:\\\\?["']?)${KEY_NAME}(?:\\\\?["']?)\\s*(?::|=)\\s*(?:\\\\?["']?))[^\\s"'\\\\&<>,}]+`,
      "gi",
    ),
    "$1[redacted]",
  ],
  [new RegExp(`\\b(${KEY_NAME})\\s+(?:is|was)\\s+\\S{12,}`, "gi"), "$1 is [redacted]"],
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
