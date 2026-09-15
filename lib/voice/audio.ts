import { CAPTURE_CHUNK_MS, PLAY_LEAD_SEC } from "@/lib/voice/realtime-latency";
import { playbackGainForCoexist } from "@/lib/voice/keepalive";
import {
  LISTEN_SAMPLE_RATE,
  MIC_AUDIO_CONSTRAINTS,
  MIC_AUDIO_CONSTRAINTS_FALLBACK,
} from "@/lib/voice/listen";

export const TARGET_RATE = LISTEN_SAMPLE_RATE;
export {
  MIC_AUDIO_CONSTRAINTS,
  MIC_AUDIO_CONSTRAINTS_FALLBACK,
  MIC_RMS_ABS_FLOOR,
  MIC_RMS_NOISE_RATIO,
  isPrimaryMicEnergy,
} from "@/lib/voice/listen";

export async function openUserMic() {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: MIC_AUDIO_CONSTRAINTS });
  } catch {
    try {
      return await navigator.mediaDevices.getUserMedia({
        audio: MIC_AUDIO_CONSTRAINTS_FALLBACK,
      });
    } catch {
      // Last try: unconstrained shared mic if a game already holds exclusive settings.
      return await navigator.mediaDevices.getUserMedia({ audio: true });
    }
  }
}

export function applyMicTrackHints(track: MediaStreamTrack) {
  try {
    track.contentHint = "speech";
  } catch {
    // contentHint is best-effort
  }
}

export async function applyMicConstraints(track: MediaStreamTrack) {
  applyMicTrackHints(track);
  try {
    await track.applyConstraints(MIC_AUDIO_CONSTRAINTS);
  } catch {
    try {
      await track.applyConstraints(MIC_AUDIO_CONSTRAINTS_FALLBACK);
    } catch {
      // constraints are best-effort
    }
  }
}

export function micTrackUsable(track?: MediaStreamTrack | null): track is MediaStreamTrack {
  return Boolean(track && track.readyState === "live" && track.enabled && !track.muted);
}

export async function resumeAudioContext(ctx: AudioContext | null | undefined) {
  if (!ctx) return;
  const state = ctx.state as string;
  if (state === "closed") return;
  if (state === "suspended" || state === "interrupted") {
    try {
      await ctx.resume();
    } catch {
      // Autoplay policy may block until the next user gesture.
    }
  }
}

/** Near-silent hold on the destination only — never the mic graph. */
export function startDestinationKeepAlive(ctx: AudioContext, ios = false) {
  const gain = ctx.createGain();
  gain.gain.value = ios ? 0.004 : 0.00006;
  gain.connect(ctx.destination);

  if (ios) {
    const seconds = 1;
    const rate = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(rate * seconds)), rate);
    const data = buffer.getChannelData(0);
    const hz = 48;
    for (let i = 0; i < data.length; i += 1) {
      data[i] = Math.sin((2 * Math.PI * hz * i) / rate);
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    source.start();
    return () => {
      try {
        source.stop();
      } catch {
        // already stopped
      }
      try {
        source.disconnect();
        gain.disconnect();
      } catch {
        // already disconnected
      }
    };
  }

  const osc = ctx.createOscillator();
  osc.frequency.value = 19;
  osc.connect(gain);
  osc.start();
  return () => {
    try {
      osc.stop();
    } catch {
      // already stopped
    }
    try {
      osc.disconnect();
      gain.disconnect();
    } catch {
      // already disconnected
    }
  };
}

export function updateMicNoiseFloor(floor: number, rms: number) {
  // Adapt only on hush / low room energy so speech does not raise the floor.
  if (rms >= 0.045) return floor;
  const alpha = rms < floor ? 0.2 : 0.06;
  const next = floor + (rms - floor) * alpha;
  return Math.min(0.025, Math.max(0.005, next));
}

const WORKLET = `
class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._chunks = [];
    this._frames = Math.round(sampleRate * ${CAPTURE_CHUNK_MS / 1000});
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

/** Shared-mode Web Audio — never request an exclusive output sink Fortnite can steal forever. */
export const AUDIO_CONTEXT_OPTIONS: AudioContextOptions = {
  sampleRate: TARGET_RATE,
  latencyHint: "interactive",
};

export function createAudioContext() {
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) throw new Error("Web Audio is not available in this browser.");
  return new Ctor(AUDIO_CONTEXT_OPTIONS);
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
  private output: GainNode;
  private ducking = false;

  constructor(
    private ctx: AudioContext,
    private rate = TARGET_RATE,
    private lead = PLAY_LEAD_SEC,
  ) {
    this.output = ctx.createGain();
    this.output.gain.value = playbackGainForCoexist(false);
    this.output.connect(ctx.destination);
  }

  get state() {
    return this.ctx.state;
  }

  setDuck(ducked: boolean) {
    if (this.ducking === ducked) return;
    this.ducking = ducked;
    const target = playbackGainForCoexist(ducked);
    const now = this.ctx.currentTime;
    try {
      this.output.gain.cancelScheduledValues(now);
      this.output.gain.setTargetAtTime(target, now, 0.04);
    } catch {
      this.output.gain.value = target;
    }
  }

  resetTurn() {
    this.clearSources();
    this.underruns = 0;
    this.drainMsMax = 0;
    this.maxGapMs = 0;
    this.queuedMs = 0;
    this.started = false;
    this.next = 0;
    this.lastScheduled = 0;
  }

  play(pcm16: Uint8Array) {
    if (this.ctx.state !== "running") void this.ctx.resume();
    const even = pcm16.byteLength % 2 === 0 ? pcm16 : pcm16.subarray(0, pcm16.byteLength - 1);
    const samples = new Int16Array(even.buffer, even.byteOffset, even.byteLength / 2);
    const floats = new Float32Array(samples.length);
    for (let i = 0; i < samples.length; i++) floats[i] = samples[i] / 32768;

    const buffer = this.ctx.createBuffer(1, floats.length, this.rate);
    buffer.copyToChannel(floats, 0);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.output);

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

  flush() {
    return this.stop();
  }

  stop() {
    const droppedMs = Math.max(0, (this.next - this.ctx.currentTime) * 1000);
    this.clearSources();
    this.started = false;
    this.next = 0;
    this.lastScheduled = 0;
    this.queuedMs = 0;
    return droppedMs;
  }

  private clearSources() {
    const sources = this.sources.splice(0);
    for (const source of sources) {
      source.onended = null;
      try {
        source.stop(0);
      } catch {
        // already stopped or not started
      }
      try {
        source.disconnect();
      } catch {
        // already disconnected
      }
    }
  }
}
