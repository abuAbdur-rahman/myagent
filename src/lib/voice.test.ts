import { describe, expect, it } from "vitest";
import { mergeChunks, pcmRms, rms, toPcm16 } from "./voice";

describe("toPcm16", () => {
  it("scales and clamps floats to signed 16-bit", () => {
    const pcm = toPcm16(new Float32Array([0, 0.5, -0.5, 2, -2]));
    expect(Array.from(pcm)).toEqual([0, 16383, -16384, 32767, -32768]);
  });

  it("returns an empty array for empty input", () => {
    expect(toPcm16(new Float32Array([])).length).toBe(0);
  });
});

describe("mergeChunks", () => {
  it("concatenates chunks in order", () => {
    const merged = mergeChunks(
      [new Float32Array([1, 2]), new Float32Array([3]), new Float32Array([4, 5])],
      10,
    );
    expect(Array.from(merged)).toEqual([1, 2, 3, 4, 5]);
  });

  it("stops at the sample limit", () => {
    const merged = mergeChunks(
      [new Float32Array([1, 2, 3]), new Float32Array([4, 5, 6])],
      4,
    );
    expect(Array.from(merged)).toEqual([1, 2, 3, 4]);
  });

  it("returns an empty array when the limit is zero", () => {
    expect(mergeChunks([new Float32Array([1])], 0).length).toBe(0);
  });
});

describe("levels", () => {
  it("reports zero for silence and empty input", () => {
    expect(rms(new Float32Array([]))).toBe(0);
    expect(rms(new Float32Array([0, 0, 0]))).toBe(0);
    expect(pcmRms(new Int16Array([]))).toBe(0);
  });

  it("reports full scale near one", () => {
    expect(rms(new Float32Array([1, -1]))).toBeCloseTo(1);
    expect(pcmRms(new Int16Array([32767, -32768]))).toBeCloseTo(1, 3);
  });
});
