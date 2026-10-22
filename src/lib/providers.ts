export type KeyStatus = "keyless" | "checking" | "unreadable" | "missing" | "untested" | "connected";

export const KEY_STATUS_TEXT: Record<KeyStatus, string> = {
  keyless: "No key needed",
  checking: "Checking…",
  unreadable: "Key unreadable",
  missing: "No key",
  untested: "Untested",
  connected: "Connected",
};

export function keyStatus(input: {
  keyless: boolean;
  loaded: boolean;
  error: string | null;
  hint: string | null;
  testedAt: number | null;
}): KeyStatus {
  if (input.keyless) return "keyless";
  if (!input.loaded) return "checking";
  if (input.error) return "unreadable";
  if (input.hint === null) return "missing";
  if (input.testedAt === null) return "untested";
  return "connected";
}
