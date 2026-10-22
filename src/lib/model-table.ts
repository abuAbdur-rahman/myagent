import {
  lookupContextLength,
  lookupEfforts,
  lookupSupportsTools,
  lookupVisionSupport,
  type ModelCapabilities,
  type VisionOverride,
  type VisionSupport,
} from "./catalog";
import type { ProviderKind } from "./types";

export interface ModelTableRow {
  key: string;
  connectionId: string;
  modelId: string;
  context: number | null;
  tools: boolean;
  vision: VisionSupport;
  catalogVision: VisionSupport;
  override: VisionOverride;
  efforts: string[];
  hidden: boolean;
}

export function contextLabel(limit: number | null): string {
  if (limit === null) return "Unknown";
  if (limit >= 1_000_000) {
    const millions = limit / 1_000_000;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
  }
  if (limit >= 1000) return `${Math.round(limit / 1000)}k`;
  return String(limit);
}

export function visionLabel(support: VisionSupport): string {
  if (support === "yes") return "Yes";
  if (support === "no") return "No";
  return "Unknown";
}

export function effectiveVision(
  caps: ModelCapabilities[] | null,
  modelId: string,
  override: VisionOverride,
): VisionSupport {
  if (override === "yes") return "yes";
  if (override === "no") return "no";
  return lookupVisionSupport(caps, modelId);
}

export function buildModelRow(input: {
  connectionId: string;
  connectionName: string;
  kind: ProviderKind;
  modelId: string;
  caps: ModelCapabilities[] | null;
  hidden: boolean;
  override: VisionOverride;
}): ModelTableRow {
  return {
    key: `${input.connectionId}::${input.modelId}`,
    connectionId: input.connectionId,
    modelId: input.modelId,
    context: lookupContextLength(input.caps, input.modelId),
    tools: lookupSupportsTools(input.caps, input.modelId, input.kind),
    vision: effectiveVision(input.caps, input.modelId, input.override),
    catalogVision: lookupVisionSupport(input.caps, input.modelId),
    override: input.override,
    efforts: lookupEfforts(input.caps, input.modelId) ?? [],
    hidden: input.hidden,
  };
}

export function filterModelRows(rows: ModelTableRow[], query: string): ModelTableRow[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter((row) => row.modelId.toLowerCase().includes(needle));
}

export function countHidden(rows: ModelTableRow[]): number {
  return rows.filter((row) => row.hidden).length;
}
