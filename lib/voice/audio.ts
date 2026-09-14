export const TARGET_RATE = 24_000;

const WORKLET = `
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._chunks = [];
    this._frames = Math.round(sampleRate * 0.1);
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      this._chunks.push(new Float32Array(channel));
      let total = 0;
      for (const chunk of this._chunks) total += chunk.length;
      if (total >= this._frames) {
        const merged = new Float32Array(total);
        let offset = 0;
        for (const chunk of this._chunks) {
          merged.set(chunk, offset);
          offset += chunk.length;
        }
        this._chunks = [];
        this.port.postMessage(merged, [merged.buffer]);
      }
    }
    return true;
  }
}
registerProcessor("pcm-capture", PcmCaptureProcessor);
`;

export function createAudioContext() {
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) throw new Error("Web Audio is not available in this browser.");
  return new Ctor({ sampleRate: TARGET_RATE });
}

export async function addCaptureWorklet(ctx: AudioContext) {
  const blob = new Blob([WORKLET], { type: "application/javascript" });
  const url = URL.createObjectURL(blob);
  try {
    await ctx.audioWorklet.addModule(url);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function resample(input: Float32Array, fromRate: number, toRate: number) {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const length = Math.max(1, Math.floor(input.length / ratio));
  const output = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const src = i * ratio;
    const i0 = Math.min(input.length - 1, Math.floor(src));
    const i1 = Math.min(input.length - 1, i0 + 1);
    const t = src - i0;
    output[i] = input[i0] * (1 - t) + input[i1] * t;
  }
  return output;
}

export function floatToPcm16(samples: Float32Array) {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const clipped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff, true);
    sum += clipped * clipped;
  }
  return { bytes, rms: Math.sqrt(sum / Math.max(1, samples.length)) };
}

export function pcm16ToBase64(bytes: Uint8Array) {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export class PcmPlayer {
  underruns = 0;
  drainMsMax = 0;
  maxGapMs = 0;
  queuedMs = 0;
  private next = 0;
  private lastScheduled = 0;
  private started = false;
  private sources: AudioBufferSourceNode[] = [];

  constructor(
    private ctx: AudioContext,
    private rate = TARGET_RATE,
    private lead = 0.15,
  ) {}

  get state() {
    return this.ctx.state;
  }

  resetTurn() {
    this.underruns = 0;
    this.drainMsMax = 0;
    this.maxGapMs = 0;
    this.queuedMs = 0;
    this.started = false;
    this.lastScheduled = 0;
  }

  play(pcm16: Uint8Array) {
    const even = pcm16.byteLength % 2 === 0 ? pcm16 : pcm16.subarray(0, pcm16.byteLength - 1);
    const samples = new Int16Array(even.buffer, even.byteOffset, even.byteLength / 2);
    const floats = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) floats[i] = samples[i] / 32768;

    const buffer = this.ctx.createBuffer(1, floats.length, this.rate);
    buffer.copyToChannel(floats, 0);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);

    const now = this.ctx.currentTime;
    if (!this.started) {
      this.next = now + this.lead;
      this.started = true;
    } else if (this.lastScheduled > 0) {
      this.maxGapMs = Math.max(this.maxGapMs, (now - this.lastScheduled) * 1000);
    }

    if (this.next < now) {
      this.underruns += 1;
      this.next = now + 0.02;
    }

    const drain = (this.next - now) * 1000;
    this.drainMsMax = Math.max(this.drainMsMax, drain);
    source.start(this.next);
    this.next += buffer.duration;
    this.queuedMs = Math.max(0, (this.next - now) * 1000);
    this.lastScheduled = now;
    this.sources.push(source);
    source.onended = () => {
      this.sources = this.sources.filter((item) => item !== source);
    };
  }

  stop() {
    const droppedMs = Math.max(0, (this.next - this.ctx.currentTime) * 1000);
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {
        // already stopped
      }
    }
    this.sources = [];
    this.started = false;
    this.next = 0;
    this.lastScheduled = 0;
    this.queuedMs = 0;
    return droppedMs;
  }
}
