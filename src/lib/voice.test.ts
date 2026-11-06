import { describe, expect, it } from "vitest";
import {
  captureProblem,
  mergeChunks,
  pcmLevel,
  pcmPeak,
  pcmRms,
  rms,
  toPcm16,
  trimSilence,
} from "./voice";

const RATE = 16_000;

function silence(seconds: number): Int16Array {
  return new Int16Array(Math.round(seconds * RATE));
}

function tone(seconds: number, amplitude = 0.05): Int16Array {
  const out = new Int16Array(Math.round(seconds * RATE));
  for (let index = 0; index < out.length; index += 1) {
    const sign = index % 2 === 0 ? 1 : -1;
    out[index] = Math.round(sign * amplitude * 32_767);
  }
  return out;
}

function concat(...parts: Int16Array[]): Int16Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Int16Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

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
    expect(pcmLevel(new Int16Array([]), RATE)).toBe(0);
    expect(pcmPeak(new Int16Array([]))).toBe(0);
  });

  it("reports full scale near one", () => {
    expect(rms(new Float32Array([1, -1]))).toBeCloseTo(1);
    expect(pcmRms(new Int16Array([32767, -32768]))).toBeCloseTo(1, 3);
  });

  it("reports full scale for one loud sample among zeros", () => {
    const pcm = new Int16Array(100);
    pcm[50] = 32_767;
    expect(pcmPeak(pcm)).toBeCloseTo(1, 3);
  });

  it("reports the loudest window, so leading silence does not dilute speech", () => {
    const pcm = concat(silence(15), tone(0.3));
    expect(pcmRms(pcm)).toBeLessThan(0.008);
    expect(pcmLevel(pcm, RATE)).toBeGreaterThan(0.03);
  });
});

describe("trimSilence", () => {
  it("drops leading and trailing silence and keeps the pad", () => {
    const speech = tone(0.4);
    const pcm = concat(silence(1), speech, silence(1));
    const trimmed = trimSilence(pcm, RATE);
    expect(trimmed.length).toBeGreaterThanOrEqual(speech.length);
    expect(trimmed.length).toBeLessThanOrEqual(speech.length + Math.round(0.25 * RATE));
  });

  it("leaves an all-silent capture untouched", () => {
    const pcm = silence(1);
    expect(trimSilence(pcm, RATE).length).toBe(pcm.length);
  });
});

describe("captureProblem", () => {
  it("reports empty for an empty capture", () => {
    expect(captureProblem(new Int16Array([]), RATE)).toBe("empty");
  });

  it("reports short for a 100 ms word", () => {
    expect(captureProblem(tone(0.1), RATE)).toBe("short");
  });

  it("accepts a 400 ms word at speech level", () => {
    expect(captureProblem(tone(0.4), RATE)).toBeNull();
  });

  it("reports silent for all-zero audio at full length", () => {
    expect(captureProblem(silence(1), RATE)).toBe("silent");
  });

  it("does not call a quiet hold silent when it carries speech", () => {
    const pcm = concat(silence(8), tone(0.3, 0.05));
    expect(captureProblem(pcm, RATE)).toBeNull();
  });
});
