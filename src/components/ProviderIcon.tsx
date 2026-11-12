import type { ComponentType } from "react";

import type { ProviderKind } from "../lib/types";
import { cn } from "../lib/utils";
import { DeepSeekMark, OllamaMark, OpenRouterMark } from "./ProviderMarks";

interface BrandGlyphProps {
  size?: number | string;
  color?: string;
}

interface Brand {
  Icon: ComponentType<BrandGlyphProps>;
  tint: string;
  soft: string;
}

const BRANDS: Partial<Record<ProviderKind, Brand>> = {
  openrouter: {
    Icon: OpenRouterMark,
    tint: "var(--provider-openrouter)",
    soft: "var(--provider-openrouter-soft)",
  },
  deepseek: {
    Icon: DeepSeekMark,
    tint: "var(--provider-deepseek)",
    soft: "var(--provider-deepseek-soft)",
  },
  ollama: {
    Icon: OllamaMark,
    tint: "var(--text)",
    soft: "var(--fill-2)",
  },
  "ollama-cloud": {
    Icon: OllamaMark,
    tint: "var(--warning)",
    soft: "var(--warning-soft)",
  },
};

const MONOGRAMS: Partial<Record<ProviderKind, string>> = {
  agentrouter: "AR",
  custom: "AP",
};

function monogramOf(kind: ProviderKind): string {
  return MONOGRAMS[kind] ?? "P";
}

export function ProviderIcon({
  kind,
  size = 28,
  className,
}: {
  kind: ProviderKind;
  size?: number;
  className?: string;
}) {
  const brand = BRANDS[kind];
  const glyph = Math.max(12, Math.round(size * 0.56));
  const box = { width: size, height: size } as const;

  if (brand) {
    return (
      <span
        aria-hidden
        className={cn("grid flex-none place-items-center rounded-field", className)}
        style={{ ...box, background: brand.soft }}
      >
        <brand.Icon size={glyph} color={brand.tint} />
      </span>
    );
  }

  return (
    <span
      aria-hidden
      className={cn(
        "grid flex-none place-items-center rounded-field bg-fill-2 font-semibold text-fg-2",
        className,
      )}
      style={{ ...box, fontSize: Math.max(10, Math.round(size * 0.34)) }}
    >
      {monogramOf(kind)}
    </span>
  );
}
