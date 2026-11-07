import { Box, Cloud, Network, Plug, Route, Waves } from "lucide-react";
import type { ProviderKind } from "../lib/types";
import { cn } from "../lib/utils";

interface Style {
  Icon: typeof Route;
  color: string;
  background: string;
}

const STYLES: Record<ProviderKind, Style> = {
  openrouter: {
    Icon: Route,
    color: "var(--provider-openrouter)",
    background: "var(--provider-openrouter-soft)",
  },
  agentrouter: {
    Icon: Network,
    color: "var(--provider-agentrouter)",
    background: "var(--provider-agentrouter-soft)",
  },
  deepseek: {
    Icon: Waves,
    color: "var(--provider-deepseek)",
    background: "var(--provider-deepseek-soft)",
  },
  "ollama-cloud": {
    Icon: Cloud,
    color: "var(--warning)",
    background: "var(--warning-soft)",
  },
  ollama: {
    Icon: Box,
    color: "var(--text-2)",
    background: "var(--fill-2)",
  },
  custom: {
    Icon: Plug,
    color: "var(--success)",
    background: "var(--success-soft)",
  },
};

export function ProviderIcon({
  kind,
  size = 28,
  className,
  title,
}: {
  kind: ProviderKind;
  size?: number;
  className?: string;
  title?: string;
}) {
  const style = STYLES[kind];
  const Icon = style.Icon;
  return (
    <span
      className={cn("grid flex-none place-items-center rounded-full", className)}
      style={{
        width: size,
        height: size,
        color: style.color,
        background: style.background,
      }}
      title={title}
      aria-hidden={title ? undefined : true}
    >
      <Icon size={Math.max(12, Math.round(size * 0.52))} strokeWidth={1.8} />
    </span>
  );
}
