export type Density = "comfortable" | "compact";

export interface Appearance {
  fontScale: number;
  density: Density;
  groupByDate: boolean;
}

export const DEFAULT_APPEARANCE: Appearance = {
  fontScale: 1,
  density: "comfortable",
  groupByDate: true,
};

export function clampFontScale(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_APPEARANCE.fontScale;
  return Math.min(1.2, Math.max(0.9, Math.round(value * 100) / 100));
}

export function parseFontScale(raw: string | null): number {
  if (raw === null) return DEFAULT_APPEARANCE.fontScale;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_APPEARANCE.fontScale;
  return clampFontScale(parsed);
}

export function parseDensity(raw: string | null): Density {
  return raw === "compact" ? "compact" : DEFAULT_APPEARANCE.density;
}

export function parseGroupByDate(raw: string | null): boolean {
  if (raw === null) return DEFAULT_APPEARANCE.groupByDate;
  return raw !== "0";
}

export function fontScaleLabel(scale: number): string {
  return `${Math.round(14 * scale)} px`;
}

export function densityLabel(density: Density): string {
  return density === "compact" ? "Compact" : "Comfortable";
}
