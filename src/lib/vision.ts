import type { VisionOverride } from "./catalog";

export interface VisionFallback {
  connectionId: string;
  model: string;
}

export interface ConnectionModelOption {
  connectionId: string;
  connectionName: string;
  modelId: string;
  seesImages: boolean;
}

const VISION_FALLBACK_KEY = "visionFallback";
const LEGACY_VISION_FALLBACK_KEY = "visionFallbackModel";
const VISION_OVERRIDE_PREFIX = "visionOverride:";

function overrideMapKey(connectionId: string | null, modelId: string): string {
  return `${connectionId ?? ""}::${modelId}`;
}

function overrideStorageKey(connectionId: string | null, modelId: string): string {
  return `${VISION_OVERRIDE_PREFIX}${overrideMapKey(connectionId, modelId)}`;
}

export function readVisionOverrides(): Record<string, VisionOverride> {
  const overrides: Record<string, VisionOverride> = {};
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith(VISION_OVERRIDE_PREFIX)) continue;
    const value = localStorage.getItem(key);
    if (value === "yes" || value === "no") {
      overrides[key.slice(VISION_OVERRIDE_PREFIX.length)] = value;
    }
  }
  return overrides;
}

export function writeVisionOverride(
  connectionId: string | null,
  modelId: string,
  value: VisionOverride,
): void {
  const key = overrideStorageKey(connectionId, modelId);
  if (value) localStorage.setItem(key, value);
  else localStorage.removeItem(key);
}

export function visionOverrideFor(
  overrides: Record<string, VisionOverride>,
  connectionId: string | null,
  modelId: string,
): VisionOverride {
  return overrides[overrideMapKey(connectionId, modelId)] ?? null;
}

export function withVisionOverride(
  overrides: Record<string, VisionOverride>,
  connectionId: string | null,
  modelId: string,
  value: VisionOverride,
): Record<string, VisionOverride> {
  const key = overrideMapKey(connectionId, modelId);
  const next = { ...overrides };
  if (value) next[key] = value;
  else delete next[key];
  return next;
}

export function readVisionFallback(): VisionFallback | null {
  const raw =
    localStorage.getItem(VISION_FALLBACK_KEY) ?? localStorage.getItem(LEGACY_VISION_FALLBACK_KEY);
  if (!raw) return null;
  const separator = raw.indexOf("::");
  const fallback =
    separator < 0
      ? { connectionId: "", model: raw }
      : { connectionId: raw.slice(0, separator), model: raw.slice(separator + 2) };
  return fallback.model.trim() ? fallback : null;
}

export function writeVisionFallback(value: VisionFallback | null): void {
  localStorage.removeItem(LEGACY_VISION_FALLBACK_KEY);
  if (value?.model.trim()) {
    localStorage.setItem(VISION_FALLBACK_KEY, `${value.connectionId}::${value.model}`);
  } else {
    localStorage.removeItem(VISION_FALLBACK_KEY);
  }
}

export function applyVisionOverride(seesImages: boolean, override: VisionOverride): boolean {
  if (override === "yes") return true;
  if (override === "no") return false;
  return seesImages;
}
