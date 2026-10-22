import { describe, expect, it } from "vitest";

import { KEY_STATUS_TEXT, keyStatus } from "./providers";

const base = {
  keyless: false,
  loaded: true,
  error: null,
  hint: "••••abcd",
  testedAt: 1_700_000_000_000,
};

describe("keyStatus", () => {
  it("calls a stored key that passed a test connected", () => {
    expect(keyStatus(base)).toBe("connected");
  });

  it("calls a stored key that was never tested untested", () => {
    expect(keyStatus({ ...base, testedAt: null })).toBe("untested");
  });

  it("calls a connection without a key missing", () => {
    expect(keyStatus({ ...base, hint: null, testedAt: null })).toBe("missing");
  });

  it("keeps checking until the vault answers", () => {
    expect(keyStatus({ ...base, loaded: false, hint: null })).toBe("checking");
  });

  it("says the key is unreadable when the vault errors", () => {
    expect(keyStatus({ ...base, error: "access denied" })).toBe("unreadable");
  });

  it("lets a local Ollama server skip the key question", () => {
    expect(keyStatus({ ...base, keyless: true, hint: null, testedAt: null })).toBe("keyless");
  });

  it("has a label for every status", () => {
    const statuses = [
      "keyless",
      "checking",
      "unreadable",
      "missing",
      "untested",
      "connected",
    ] as const;
    for (const status of statuses) {
      expect(KEY_STATUS_TEXT[status].length).toBeGreaterThan(0);
    }
  });
});
