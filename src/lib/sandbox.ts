import type { SandboxStatus } from "./api";

export function parsePackages(extras: string[], advanced: string): string[] {
  const typed = advanced
    .split(/[\s,]+/)
    .map((name) => name.trim())
    .filter(Boolean);
  return [...new Set([...extras, ...typed])];
}

export function toggleAllowed(
  status: Pick<SandboxStatus, "state" | "enabled">,
  root: string,
): boolean {
  if (status.enabled) return true;
  if (status.state === "no_image") return root.trim().length > 0;
  return status.state === "ready";
}

export function imageSizeLabel(bytes: number | null): string {
  if (!bytes) return "";
  return `${Math.round(bytes / 1024 / 1024)} MB image`;
}

export function blockedReason(
  status: Pick<SandboxStatus, "state">,
  root: string,
): string | null {
  if (status.state === "not_installed") return "Docker Desktop is not installed";
  if (status.state === "daemon_stopped") return "Docker Desktop is not running";
  if (status.state === "no_image" && !root.trim()) return "Choose a project folder first";
  return null;
}
