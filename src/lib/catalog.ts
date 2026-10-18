import { z } from "zod";

import type { ProviderKind } from "./types";

const backendCapsSchema = z.object({
  id: z.string(),
  context_length: z.number().nullable().optional(),
  supports_tools: z.boolean().nullable().optional(),
  supports_reasoning: z.boolean().nullable().optional(),
  supports_vision: z.boolean().nullable().optional(),
  efforts: z.array(z.string()).nullable().optional(),
  mandatory: z.boolean().optional(),
});

const backendCatalogSchema = z.array(backendCapsSchema);

export interface ModelCapabilities {
  id: string;
  contextLength: number | null;
  supportsTools: boolean | null;
  supportsVision: boolean | null;
  reasoningEfforts: string[] | null;
  reasoningMandatory: boolean;
}

const GATEWAY_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];

const FAMILY_PATTERNS: { test: RegExp; efforts: string[] }[] = [
  { test: /^(o1|o3|o4|gpt-5|grok)/i, efforts: ["none", "minimal", "low", "medium", "high", "xhigh"] },
  { test: /claude/i, efforts: ["none", "low", "medium", "high", "xhigh", "max"] },
  { test: /gemini/i, efforts: ["low", "medium", "high"] },
  { test: /deepseek.*reason|reasoner/i, efforts: ["none", "low", "medium", "high"] },
  { test: /qwen.*think|thinking/i, efforts: ["none", "low", "medium", "high"] },
];

function familyEfforts(modelId: string): string[] | null {
  for (const family of FAMILY_PATTERNS) {
    if (family.test.test(modelId)) return family.efforts;
  }
  return null;
}

const VISION_YES: RegExp[] = [
  /gpt-4o|gpt-4\.1|gpt-4-turbo|gpt-4-vision|gpt-5|chatgpt-4o/i,
  /^o[34](?!-?mini)(\b|[-.])/i,
  /claude-(3|4)|claude-(sonnet|opus|haiku)/i,
  /gemini/i,
  /gemma-?3|llama-4|llama-3\.2.*vision/i,
  /(^|[-/])(vl|vision)([-.]|$)|pixtral|llava|internvl|moondream|qwen.*vl/i,
];

const VISION_NO: RegExp[] = [
  /deepseek-(chat|reasoner|coder|v[23])|deepseek-r1/i,
  /^o[13]-?mini/i,
  /^gpt-4(?!o|\.1|-turbo|-vision)|gpt-3\.5/i,
  /llama-3([.][01])?[-.]|llama-2/i,
  /mixtral|mistral-(small|nemo|7b|8x)/i,
  /phi-[34]/i,
  /gemma-?[12](\b|[-.])/i,
  /^qwen/i,
  /grok-[12](\b|[-.])/i,
];

export type VisionSupport = "yes" | "no" | "unknown";
export type VisionOverride = "yes" | "no" | null;

export function knownModelVision(modelId: string): VisionSupport {
  for (const pattern of VISION_YES) {
    if (pattern.test(modelId)) return "yes";
  }
  for (const pattern of VISION_NO) {
    if (pattern.test(modelId)) return "no";
  }
  return "unknown";
}

export function lookupSupportsTools(
  catalog: ModelCapabilities[] | null,
  modelId: string,
  kind: ProviderKind | undefined,
): boolean {
  const entry = catalog?.find((m) => m.id === modelId);
  if (entry?.supportsTools === false) return false;
  if (entry?.supportsTools === true) return true;
  return kind === "openrouter" || kind === "agentrouter";
}

export function parseBackendCaps(raw: unknown): ModelCapabilities[] {
  const rows = backendCatalogSchema.parse(raw);
  return rows.map((m) => ({
    id: m.id,
    contextLength: m.context_length ?? null,
    supportsTools: m.supports_tools ?? null,
    supportsVision: m.supports_vision ?? null,
    reasoningEfforts:
      m.efforts ?? (m.supports_reasoning ? [...GATEWAY_EFFORTS] : null),
    reasoningMandatory: m.mandatory ?? false,
  }));
}

export function lookupVisionSupport(
  catalog: ModelCapabilities[] | null,
  modelId: string,
): VisionSupport {
  const entry = catalog?.find((m) => m.id === modelId);
  if (entry?.supportsVision === true) return "yes";
  if (entry?.supportsVision === false) return "no";
  return knownModelVision(modelId);
}

export function modelCanSeeImages(
  catalog: ModelCapabilities[] | null,
  modelId: string,
  override: VisionOverride = null,
): boolean {
  if (override === "yes") return true;
  if (override === "no") return false;
  return lookupVisionSupport(catalog, modelId) !== "no";
}

export function lookupEfforts(
  catalog: ModelCapabilities[] | null,
  modelId: string,
): string[] | null {
  const entry = catalog?.find((m) => m.id === modelId);
  if (entry) {
    if (!entry.reasoningEfforts) return null;
    return entry.reasoningMandatory
      ? entry.reasoningEfforts.filter((level) => level !== "none")
      : entry.reasoningEfforts;
  }
  return familyEfforts(modelId);
}

export function lookupContextLength(
  catalog: ModelCapabilities[] | null,
  modelId: string,
): number | null {
  return catalog?.find((m) => m.id === modelId)?.contextLength ?? null;
}
