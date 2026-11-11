import DeepSeek from "@lobehub/icons/es/DeepSeek/components/Mono";
import Ollama from "@lobehub/icons/es/Ollama/components/Mono";
import OpenRouter from "@lobehub/icons/es/OpenRouter/components/Mono";
import type { ComponentType } from "react";

import type { ProviderKind } from "../lib/types";
import { cn } from "../lib/utils";

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
    Icon: OpenRouter,
    tint: "var(--provider-openrouter)",
    soft: "var(--provider-openrouter-soft)",
  },
  deepseek: {
    Icon: DeepSeek,
    tint: "var(--provider-deepseek)",
    soft: "var(--provider-deepseek-soft)",
  },
  ollama: {
    Icon: Ollama,
    tint: "var(--text)",
    soft: "var(--fill-2)",
  },
  "ollama-cloud": {
    Icon: Ollama,
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
  const shared = {
    width: size,
    height: size,
    "aria-hidden": true,
  } as const;

  if (brand) {
    return (
      <span
        {...shared}
        className={cn("grid flex-none place-items-center rounded-field", className)}
        style={{ background: brand.soft }}
      >
        <brand.Icon size={glyph} color={brand.tint} />
      </span>
    );
  }

  return (
    <span
      {...shared}
      className={cn(
        "grid flex-none place-items-center rounded-field bg-fill-2 font-semibold text-fg-2",
        className,
      )}
      style={{ fontSize: Math.max(10, Math.round(size * 0.34)) }}
    >
      {monogramOf(kind)}
    </span>
  );
}
