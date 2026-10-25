import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { formatInvokeError } from "./api";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function newId() {
  return crypto.randomUUID();
}

export function errorText(error: unknown): string {
  const text = formatInvokeError(error).trim();
  return text.length > 0 ? text : "Something went wrong. Please try again.";
}

export function downloadText(filename: string, text: string, mime = "text/plain") {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export async function rollbackConnection(
  remove: (id: string) => Promise<void>,
  id: string | null,
): Promise<string | null> {
  if (!id) return null;
  try {
    await remove(id);
    return null;
  } catch (cause) {
    return formatInvokeError(cause);
  }
}
