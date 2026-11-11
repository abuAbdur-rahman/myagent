import { accentIdOf, accentLabel, accentSwatch } from "./accent";

export interface VisualTheme {
  mode: "dark" | "light";
  accentId: string;
  accentLabel: string;
  tokens: Record<string, string>;
}

interface SurfaceTokens {
  bg: string;
  card: string;
  raised: string;
  fg: string;
  muted: string;
  border: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
}

const DARK: SurfaceTokens = {
  bg: "#232220",
  card: "#2b2a27",
  raised: "#32312d",
  fg: "#ebe8e2",
  muted: "#b4afa6",
  border: "rgba(255, 248, 235, 0.12)",
  success: "#6cc48a",
  warning: "#e6b055",
  danger: "#f0757c",
  info: "#7db1f0",
};

const LIGHT: SurfaceTokens = {
  bg: "#faf9f6",
  card: "#ffffff",
  raised: "#ffffff",
  fg: "#1f1d1a",
  muted: "#5d5953",
  border: "rgba(40, 30, 10, 0.13)",
  success: "#1d7a3e",
  warning: "#8a5a00",
  danger: "#be2f3a",
  info: "#1f5fae",
};

function resolveCssVars(
  value: string,
  style: CSSStyleDeclaration | null,
  seen: ReadonlySet<string> = new Set(),
): string {
  return value.replace(
    /var\(\s*(--[\w-]+)(?:\s*,\s*([^()]*))?\s*\)/g,
    (_match, name: string, fallback = "") => {
      if (seen.has(name)) return fallback.trim();
      const next = style?.getPropertyValue(name).trim();
      if (!next) return fallback.trim();
      const nested = new Set(seen);
      nested.add(name);
      return resolveCssVars(next, style, nested);
    },
  );
}

export function readVisualTheme(selection?: {
  mode?: VisualTheme["mode"];
  accentId?: string;
}): VisualTheme {
  const root = typeof document === "undefined" ? null : document.documentElement;
  const mode =
    selection?.mode ?? (root?.getAttribute("data-theme") === "light" ? "light" : "dark");
  const accentId = accentIdOf(
    selection?.accentId ?? root?.getAttribute("data-accent") ?? "clay",
  );
  const fallback = mode === "dark" ? DARK : LIGHT;
  const domAccent = accentIdOf(root?.getAttribute("data-accent") ?? "clay");
  const applied = root?.getAttribute("data-theme") === mode && domAccent === accentId;
  const style = applied && root ? getComputedStyle(root) : null;
  const read = (name: string, value: string) => {
    const raw = style?.getPropertyValue(name).trim() || value;
    return resolveCssVars(raw, style, new Set([name])) || value;
  };
  const accent = read("--accent-solid", accentSwatch(accentId));
  return {
    mode,
    accentId,
    accentLabel: accentLabel(accentId),
    tokens: {
      "--myagent-bg": read("--bg-canvas", fallback.bg),
      "--myagent-card": read("--bg-raised", fallback.card),
      "--myagent-raised": read("--bg-overlay", fallback.raised),
      "--myagent-fg": read("--text", fallback.fg),
      "--myagent-muted": read("--text-2", fallback.muted),
      "--myagent-border": read("--line", fallback.border),
      "--myagent-accent": accent,
      "--myagent-accent-text": read("--accent-text", accent),
      "--myagent-accent-soft": read("--accent-soft", "transparent"),
      "--myagent-success": read("--success", fallback.success),
      "--myagent-warning": read("--warning", fallback.warning),
      "--myagent-danger": read("--danger", fallback.danger),
      "--myagent-info": read("--info", fallback.info),
      "--myagent-radius": read("--radius-card", "12px"),
      "--myagent-font": read("--font-sans", "Segoe UI, system-ui, sans-serif"),
    },
  };
}

export function visualThemePrompt(theme: VisualTheme): string {
  return [
    "## Visual theme",
    `The app is in ${theme.mode} mode with the ${theme.accentLabel} accent.`,
    `Inline \`viz\` pages and generated interfaces must use these CSS variables, which the frame sets at runtime: ${Object.keys(
      theme.tokens,
    ).join(", ")}.`,
    "Use --myagent-bg for the page, --myagent-card for panels, --myagent-fg for text, --myagent-muted for secondary text, --myagent-border for hairlines, --myagent-radius for corners, and --myagent-accent only for the primary action, selection or emphasis.",
    "Write every colour as var(--myagent-name, fallback) and keep the fallback consistent with the current mode. Never hardcode #fff, #000, a light card on a dark app, or a second palette.",
  ].join("\n");
}
