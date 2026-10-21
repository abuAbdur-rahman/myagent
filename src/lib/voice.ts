const WORKLET_URL = "/pcm-worklet.js";
const TARGET_RATE = 16_000;
const MAX_SECONDS = 60;

export type Capture = {
  pcm: Int16Array;
  sampleRate: number;
};

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

export class VoiceRecorder {
  private context: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private chunks: Float32Array[] = [];
  private frames = 0;
  private rate = TARGET_RATE;
  private starting = false;

  async start(): Promise<void> {
    if (this.context || this.starting) return;
    this.starting = true;
    this.chunks = [];
    this.frames = 0;
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      context = new AudioContext({ sampleRate: TARGET_RATE });
      await context.audioWorklet.addModule(WORKLET_URL);
      const source = context.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(context, "pcm-processor");
      node.port.onmessage = (event: MessageEvent<Float32Array>) => {
        const chunk = event.data;
        if (!(chunk instanceof Float32Array) || chunk.length === 0) return;
        if (this.frames >= this.rate * MAX_SECONDS) return;
        const room = this.rate * MAX_SECONDS - this.frames;
        const kept = chunk.length > room ? chunk.subarray(0, room) : chunk;
        this.chunks.push(kept);
        this.frames += kept.length;
      };
      const sink = context.createGain();
      sink.gain.value = 0;
      source.connect(node);
      node.connect(sink);
      sink.connect(context.destination);
      await context.resume();
      this.stream = stream;
      this.context = context;
      this.source = source;
      this.node = node;
      this.rate = context.sampleRate;
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      await context?.close().catch(() => undefined);
      throw error;
    } finally {
      this.starting = false;
    }
  }

  async finish(): Promise<Capture> {
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

  private async teardown(): Promise<void> {
    this.node?.port.close();
    this.node?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    const context = this.context;
    this.context = null;
    this.stream = null;
    this.source = null;
    this.node = null;
    if (context) await context.close().catch(() => undefined);
  }
}

