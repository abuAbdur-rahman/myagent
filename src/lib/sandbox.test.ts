import { describe, expect, it } from "vitest";
import { blockedReason, imageSizeLabel, parsePackages, toggleAllowed } from "./sandbox";
import type { SandboxStatus } from "./api";

const base: SandboxStatus = {
  state: "ready",
  enabled: true,
  docker: "29.9.1",
  image: "sha256:abc",
  image_size: 262_144_000,
  project_root: "D:\\oss\\demo",
  profile: "office",
  allow_installs: false,
  packages: [],
  cpus: 1,
  memory_mb: 1024,
  detail: null,
};

describe("sandbox helpers", () => {
  it("merges checked extras with typed packages without duplicates", () => {
    expect(parsePackages(["jq", "python3-numpy"], "jq, ripgrep\ncurl")).toEqual([
      "jq",
      "python3-numpy",
      "ripgrep",
      "curl",
    ]);
    expect(parsePackages([], "  ")).toEqual([]);
  });

  it("allows turning off even when Docker disappeared", () => {
    expect(toggleAllowed({ state: "daemon_stopped", enabled: true }, "")).toBe(true);
    expect(toggleAllowed({ state: "not_installed", enabled: true }, "")).toBe(true);
  });

  it("only starts once the runtime and folder are ready", () => {
    expect(toggleAllowed({ state: "ready", enabled: false }, "")).toBe(true);
    expect(toggleAllowed({ state: "no_image", enabled: false }, "D:\\oss\\demo")).toBe(true);
    expect(toggleAllowed({ state: "no_image", enabled: false }, "")).toBe(false);
    expect(toggleAllowed({ state: "not_installed", enabled: false }, "D:\\oss\\demo")).toBe(
      false,
    );
    expect(toggleAllowed({ state: "daemon_stopped", enabled: false }, "D:\\oss\\demo")).toBe(
      false,
    );
  });

  it("explains each blocked state from the live folder selection", () => {
    expect(blockedReason({ state: "not_installed" }, "")).toMatch(/not installed/);
    expect(blockedReason({ state: "daemon_stopped" }, "")).toMatch(/not running/);
    expect(blockedReason({ state: "no_image" }, "")).toMatch(/project folder/);
    expect(blockedReason({ state: "no_image" }, "D:\\oss\\demo")).toBeNull();
    expect(blockedReason(base, "")).toBeNull();
  });

  it("formats the image size", () => {
    expect(imageSizeLabel(262_144_000)).toBe("250 MB image");
    expect(imageSizeLabel(null)).toBe("");
  });
});
