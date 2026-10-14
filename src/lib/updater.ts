import { getVersion } from "@tauri-apps/api/app";
import type { Update } from "@tauri-apps/plugin-updater";

export async function getAppVersion(): Promise<string> {
  try {
    return await getVersion();
  } catch {
    return "unknown";
  }
}

export function channelMessage(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (/404|not found/i.test(text)) {
    return "No public release channel yet — releases must be public for in-app updates.";
  }
  if (/network|fetch|failed|econn|timed out|timeout/i.test(text)) {
    return "Couldn't reach the update channel. Check your connection and retry.";
  }
  return text.length > 160 ? `${text.slice(0, 160)}…` : text;
}

export type { Update };

export async function installUpdate(
  update: Update,
  onProgress: (pct: number | null, bytes: number) => void,
): Promise<void> {
  let total: number | null = null;
  let received = 0;
  await update.downloadAndInstall((event) => {
    if (event.event === "Started") {
      total = event.data.contentLength ?? null;
    } else if (event.event === "Progress") {
      received += event.data.chunkLength;
      onProgress(total ? Math.min(99, Math.round((received / total) * 100)) : null, received);
    } else if (event.event === "Finished") {
      onProgress(100, received);
    }
  });
}
