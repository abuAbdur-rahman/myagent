const WORKLET_URL = "/pcm-worklet.js";
const TARGET_RATE = 16_000;
const MAX_SECONDS = 60;
const LEVEL_WINDOW_SECONDS = 0.05;
const LEVEL_PAD_SECONDS = 0.1;
const MIN_CAPTURE_SECONDS = 0.3;
const SILENT_LEVEL = 0.003;

export type Capture = {
  pcm: Int16Array;
  sampleRate: number;
};

export type CaptureProblem = "empty" | "short" | "silent";

let shared: AudioContext | null = null;
let moduleLoaded: Promise<void> | null = null;

function sharedContext(): AudioContext {
  if (!shared) shared = new AudioContext({ sampleRate: TARGET_RATE });
  return shared;
}

export function primeWorklet(): Promise<void> {
  const context = sharedContext();
  if (!moduleLoaded) {
    moduleLoaded = context.audioWorklet.addModule(WORKLET_URL).catch((error: unknown) => {
      moduleLoaded = null;
      throw error;
    });
  }
  return moduleLoaded;
}

export function toPcm16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index]));
    out[index] = value < 0 ? value * 0x8000 : value * 0x7fff;
  }
  return out;
}

export function rms(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

export function pcmRms(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let sum = 0;
  for (const sample of pcm) {
    const value = sample / 32_768;
    sum += value * value;
  }
  return Math.sqrt(sum / pcm.length);
}

export function pcmPeak(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let peak = 0;
  for (const sample of pcm) {
    const value = Math.abs(sample);
    if (value > peak) peak = value;
  }
  return peak / 32_768;
}

function windowLevel(pcm: Int16Array, start: number, end: number): number {
  let sum = 0;
  for (let index = start; index < end; index += 1) {
    const value = pcm[index] / 32_768;
    sum += value * value;
  }
  return Math.sqrt(sum / (end - start));
}

/** Loudest 50 ms window, sliding in 12.5 ms steps, so quiet speech split across blocks still counts. */
export function pcmLevel(pcm: Int16Array, sampleRate: number): number {
  if (pcm.length === 0) return 0;
  const size = Math.max(1, Math.round(sampleRate * LEVEL_WINDOW_SECONDS));
  const hop = Math.max(1, Math.round(size / 4));
  let level = 0;
  for (let start = 0; start < pcm.length; start += hop) {
    const end = Math.min(pcm.length, start + size);
    const window = windowLevel(pcm, start, end);
    if (window > level) level = window;
  }
  return level;
}

export function trimSilence(pcm: Int16Array, sampleRate: number): Int16Array {
  const size = Math.max(1, Math.round(sampleRate * LEVEL_WINDOW_SECONDS));
  const pad = Math.max(1, Math.round(sampleRate * LEVEL_PAD_SECONDS));
  let first = -1;
  let last = -1;
  for (let start = 0; start < pcm.length; start += size) {
    const end = Math.min(pcm.length, start + size);
    if (windowLevel(pcm, start, end) < SILENT_LEVEL) continue;
    if (first < 0) first = start;
    last = end;
  }
  if (first < 0) return pcm;
  return pcm.subarray(Math.max(0, first - pad), Math.min(pcm.length, last + pad));
}

export function captureProblem(pcm: Int16Array, sampleRate: number): CaptureProblem | null {
  if (pcm.length === 0) return "empty";
  if (pcm.length / sampleRate < MIN_CAPTURE_SECONDS) return "short";
  if (pcmLevel(pcm, sampleRate) < SILENT_LEVEL) return "silent";
  return null;
}

export function mergeChunks(chunks: Float32Array[], limit: number): Float32Array {
  const total = Math.min(
    limit,
    chunks.reduce((sum, chunk) => sum + chunk.length, 0),
  );
  const merged = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= total) break;
    const take = Math.min(chunk.length, total - offset);
    merged.set(chunk.subarray(0, take), offset);
    offset += take;
  }
  return merged;
}

function stopTracks(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

export class VoiceRecorder {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private sink: GainNode | null = null;
  private chunks: Float32Array[] = [];
  private frames = 0;
  private rate = TARGET_RATE;
  private starting = false;
  private flushed: (() => void) | null = null;

  async start(): Promise<void> {
    if (this.context || this.starting) return;
    this.starting = true;
    this.chunks = [];
    this.frames = 0;
    let stream: MediaStream | null = null;
    let acquired: MediaStream | null = null;
    let aborted = false;
    const media = navigator.mediaDevices
      .getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
      .then((found) => {
        acquired = found;
        if (aborted) found.getTracks().forEach((track) => track.stop());
        return found;
      });
    void media.catch(() => undefined);
    try {
      const context = sharedContext();
      this.rate = context.sampleRate;
      await primeWorklet();
      stream = await media;
      await context.resume();
      if (context.state !== "running") throw new Error("the microphone did not start");
      const source = context.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(context, "pcm-processor");
      node.port.onmessage = (event: MessageEvent<unknown>) => {
        const data = event.data;
        if (data === "flushed") {
          this.flushed?.();
          this.flushed = null;
          return;
        }
        if (!(data instanceof Float32Array) || data.length === 0) return;
        const room = this.rate * MAX_SECONDS - this.frames;
        if (room <= 0) return;
        const kept = data.length > room ? data.subarray(0, room) : data;
        this.chunks.push(kept);
        this.frames += kept.length;
      };
      const sink = context.createGain();
      sink.gain.value = 0;
      source.connect(node);
      node.connect(sink);
      sink.connect(context.destination);
      this.stream = stream;
      this.context = context;
      this.source = source;
      this.node = node;
      this.sink = sink;
    } catch (error) {
      aborted = true;
      stopTracks(stream);
      stopTracks(acquired);
      this.node?.port.close();
      this.node?.disconnect();
      this.source?.disconnect();
      this.sink?.disconnect();
      this.stream = null;
      this.context = null;
      this.source = null;
      this.node = null;
      this.sink = null;
      throw error;
    } finally {
      this.starting = false;
    }
  }

  async finish(): Promise<Capture> {
    await this.flush();
    const chunks = this.chunks;
    const rate = this.rate;
    this.chunks = [];
    this.frames = 0;
    await this.teardown();
    const merged = mergeChunks(chunks, rate * MAX_SECONDS);
    return { pcm: toPcm16(merged), sampleRate: rate };
  }

  async cancel(): Promise<void> {
    this.chunks = [];
    this.frames = 0;
    await this.teardown();
  }

  private flush(): Promise<void> {
    const node = this.node;
    if (!node) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.flushed = resolve;
      node.port.postMessage("flush");
      setTimeout(() => {
        if (this.flushed === resolve) this.flushed = null;
        resolve();
      }, 150);
    });
  }

  private async teardown(): Promise<void> {
    this.node?.port.close();
    this.node?.disconnect();
    this.sink?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.flushed = null;    this.context = null;
    this.stream = null;
    this.source = null;
    this.node = null;
    this.sink = null;
  }
}
