import { z } from "zod";

const catalogReasoningSchema = z.object({
  supported_efforts: z.array(z.string()).nullable().optional(),
  mandatory: z.boolean().optional(),
});

const catalogModelSchema = z.object({
  id: z.string(),
  context_length: z.number().optional(),
  supported_parameters: z.array(z.string()).optional(),
  reasoning: catalogReasoningSchema.optional(),
});

const catalogSchema = z.object({
  data: z.array(catalogModelSchema),
});

export interface ModelCapabilities {
  id: string;
  contextLength: number | null;
  reasoningEfforts: string[] | null;
  reasoningMandatory: boolean;
}

const cache = new Map<string, Promise<ModelCapabilities[]>>();

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

function toCapabilities(raw: z.infer<typeof catalogSchema>): ModelCapabilities[] {
  return raw.data.map((m) => {
    const supported = m.supported_parameters ?? [];
    const hasReasoning =
      supported.includes("reasoning") || supported.includes("include_reasoning");
    const efforts = m.reasoning?.supported_efforts ?? null;
    return {
      id: m.id,
      contextLength: m.context_length ?? null,
      reasoningEfforts:
        efforts ?? (hasReasoning ? [...GATEWAY_EFFORTS] : null),
      reasoningMandatory: m.reasoning?.mandatory ?? false,
    };
  });
}

export function fetchCatalog(): Promise<ModelCapabilities[]> {
  const cached = cache.get("openrouter");
  if (cached) return cached;
  const task = fetch("https://openrouter.ai/api/v1/models")
    .then(async (response) => {
      if (!response.ok) throw new Error(`catalog ${response.status}`);
      const json: unknown = await response.json();
      return toCapabilities(catalogSchema.parse(json));
    })
    .catch((error) => {
      cache.delete("openrouter");
      throw error;
    });
  cache.set("openrouter", task);
  return task;
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
