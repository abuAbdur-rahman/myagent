import { describe, expect, it, vi } from "vitest";

import {
  downscaleImage,
  fitImageBudget,
  imageByteSize,
  isSupportedImage,
  targetSize,
  IMAGE_TURN_TARGET_BYTES,
  IMAGE_TURN_TRIGGER_BYTES,
  MAX_IMAGE_SIDE,
} from "./image";

describe("isSupportedImage", () => {
  it("accepts the v1 allowlist", () => {
    expect(isSupportedImage("image/png")).toBe(true);
    expect(isSupportedImage("image/jpeg")).toBe(true);
    expect(isSupportedImage("image/gif")).toBe(true);
    expect(isSupportedImage("image/webp")).toBe(true);
  });

  it("rejects everything else", () => {
    expect(isSupportedImage("image/svg+xml")).toBe(false);
    expect(isSupportedImage("application/pdf")).toBe(false);
    expect(isSupportedImage("text/plain")).toBe(false);
  });
});

describe("targetSize", () => {
  it("caps the long side at 1568 preserving aspect", () => {
    expect(targetSize(4000, 2000, 1568)).toEqual({ width: 1568, height: 784 });
    expect(targetSize(2000, 4000, 1568)).toEqual({ width: 784, height: 1568 });
  });

  it("leaves small images untouched", () => {
    expect(targetSize(800, 600, 1568)).toEqual({ width: 800, height: 600 });
  });

  it("clamps extreme aspect ratios to at least one pixel", () => {
    expect(targetSize(12000, 1, 1568)).toEqual({ width: 1568, height: 1 });
  });
});

describe("budgets", () => {
  it("exposes sane tuning constants", () => {
    expect(MAX_IMAGE_SIDE).toBe(1568);
    expect(IMAGE_TURN_TRIGGER_BYTES).toBe(25 * 1024 * 1024);
    expect(IMAGE_TURN_TARGET_BYTES).toBe(15 * 1024 * 1024);
    expect(imageByteSize("data:image/jpeg;base64,AAAA")).toBe(3);
  });
});

describe("fitImageBudget", () => {
  const imageOf = (bytes: number) => ({
    dataUrl: `data:image/jpeg;base64,${"A".repeat(Math.ceil(bytes * 4 / 3))}`,
  });

  it("keeps everything under the trigger", () => {
    const fit = fitImageBudget([imageOf(100), imageOf(200)], 1000, 800);
    expect(fit.kept).toHaveLength(2);
    expect(fit.dropped).toBe(0);
  });

  it("drops oldest-first down to target over the trigger", () => {
    const big = imageOf(700);
    const fit = fitImageBudget([big, imageOf(500), imageOf(500)], 1000, 1200);
    expect(fit.dropped).toBe(1);
    expect(fit.kept).toHaveLength(2);
    expect(fit.kept).not.toContain(big);
  });
});

describe("downscaleImage", () => {
  it("draws to canvas and returns a JPEG data-URL", async () => {
    const drawImage = vi.fn();
    const fillRect = vi.fn();
    const toDataURL = vi.fn(() => "data:image/jpeg;base64,AAA");
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage, fillRect, fillStyle: "" }),
      toDataURL,
    };
    vi.stubGlobal("document", {
      createElement: () => canvas,
    });
    const revoke = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: () => "blob:x", revokeObjectURL: revoke });
    class FakeImage {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 4000;
      naturalHeight = 2000;
      set src(_value: string) {
        this.onload?.();
      }
    }
    vi.stubGlobal("Image", FakeImage);

    const out = await downscaleImage(new Blob(["x"], { type: "image/png" }));
    expect(canvas.width).toBe(1568);
    expect(canvas.height).toBe(784);
    expect(drawImage).toHaveBeenCalledOnce();
    expect(fillRect).toHaveBeenCalledOnce();
    expect(out.dataUrl).toBe("data:image/jpeg;base64,AAA");
    vi.unstubAllGlobals();
  });

  it("rejects unsupported blobs", async () => {
    await expect(
      downscaleImage(new Blob(["x"], { type: "application/pdf" })),
    ).rejects.toThrow(/not supported/i);
  });
});
