export interface AccentPreset {
  id: string;
  label: string;
  hue: number;
}

export const ACCENT_PRESETS: AccentPreset[] = [
  { id: "clay", label: "Clay", hue: 38 },
  { id: "blue", label: "Blue", hue: 255 },
  { id: "green", label: "Green", hue: 150 },
  { id: "violet", label: "Violet", hue: 295 },
  { id: "pink", label: "Pink", hue: 350 },
  { id: "graphite", label: "Graphite", hue: 80 },
];

export const DEFAULT_ACCENT = "clay";

const LEGACY_HEX: Record<string, string> = {
  "#c96442": "clay",
  "#0067c0": "blue",
  "#0f7b0f": "green",
  "#7a42d6": "violet",
  "#c239b3": "pink",
  "#5c5c5c": "graphite",
};

export function accentIdOf(value: string): string {
  const raw = value.trim().toLowerCase();
  if (ACCENT_PRESETS.some((preset) => preset.id === raw)) return raw;
  return LEGACY_HEX[raw] ?? DEFAULT_ACCENT;
}

export function parseAccent(raw: string | null): string {
  return raw ? accentIdOf(raw) : DEFAULT_ACCENT;
}

export function accentLabel(id: string): string {
  return ACCENT_PRESETS.find((preset) => preset.id === id)?.label ?? "Clay";
}

export function accentSwatch(id: string): string {
  const preset = ACCENT_PRESETS.find((item) => item.id === id) ?? ACCENT_PRESETS[0];
  if (preset.id === "graphite") return "oklch(0.45 0.012 80)";
  return `oklch(0.55 0.14 ${preset.hue})`;
}
