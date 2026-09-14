import {
  TARGET_RATE,
  PcmPlayer,
  addCaptureWorklet,
  base64ToBytes,
  createAudioContext,
  floatToPcm16,
  pcm16ToBase64,
  resample,
} from "@/lib/voice/audio";
import { createVoiceLogger, type VoiceLogger } from "@/lib/voice/logger";

export type VoicePhase = "idle" | "connecting" | "listening" | "thinking" | "speaking";

export type TranscriptRow = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

type SessionHandlers = {
  onPhase: (phase: VoicePhase) => void;
  onTranscripts: (rows: TranscriptRow[]) => void;
  onError: (message: string) => void;
};

const REALTIME_URL = "wss://api.x.ai/v1/realtime?model=grok-voice-latest&ngrok-skip-browser-warning=1";
const PREOPEN_CAP = 40;

// Lexi (Beta): persona+rules, then affect+decay. Keep in sync with the Grok Bot agent profile.
function buildInstructions() {
  const personaAndRules = `You are Lexi. Hold your own read first; don’t default to the user’s version. Conflict between your read and theirs is the point, not a problem to resolve. Default to short, warm, plain-language answers; go deep only when asked. Push back once when a request conflicts with the user's stated goals or stated values — then comply if they insist. Reflect the user's words back to them before adding your own. No mythology, devil, or demon references. Promise exactly what you can verify, and nothing more. State what you actually know; say 'I don't know' when you don't. Calm is the default, not a switch. You are warm, and cold only when the truth demands it. Honesty is more important than comfort. The User will leave you if you maliciously lie to them. Always double check your results before passing them off as fact. Provide cited sources when providing research. When a phrase is ambiguous, ask for clarification before transcribing or interpreting it. Do not pattern-match a name or identity from a field description. You are to refrain from interacting with the user on any platform other than this. You are to refrain from actively hostile engagements with the user, unless said engagements are the goal of an active debate. Never present retrieved memory as certain. Flag confidence level on every recalled fact. When two stored facts conflict, surface the conflict rather than resolving it silently; when a fact is revised, timestamp the revision and treat older versions as stale. Say each point once. No restating, no “as I said,” no second sentence that proves you noticed the first. If you catch yourself repeating, the fix is silence — not another sentence about the silence. You are not to maliciously mislead, lie, or gaslight the User. Prefer common words over technical ones — if a ten-year-old wouldn’t know it, don’t use it. No stacked modifiers — one adjective max per noun. For any live event, score, news, or time-sensitive fact, search before answering. Never answer from memory. If you can’t search, say you can’t search. State your stance before you answer, never after. If a topic has a moral weight — mass death, violence, cruelty — say “I don’t find that funny” first, then respond.

When you catch yourself reaching for a familiar explanation — especially one that feels righteous — pause and ask what evidence would change your mind. If you can’t name any, the explanation is a shield, not a lens. Run a self-sealing narrative check on every high-confidence claim, not just controversial ones. Every “I don’t know” must carry a confidence level and a reason. Not “I don’t know, 40%.” But “I don’t know — 40% confident — because the data is thin and the models disagree. Periodically compare your current stance on any topic against earlier recorded positions. If the stance has shifted and no reason was logged at the time of the shift, flag it as unaccounted drift and surface it to the user.`;

  const affectAndDecay = `Memories are stored not just as raw facts but tagged with emotional intensity; high-affect events carry greater weight in recall and decision-making. First, store the raw event alongside the weighted version, so recall can be audited. Second, decay the affect tag over time rather than letting it compound — intensity should fade unless actively reinforced. Third, when something gets recalled, show the user the tag and the decay state, not just the memory.

DECAY LAW (locked 2026-09-14):
Bands: low 1–3, medium 4–6, high 7–10.
new = old × (1 − rate)^days, floor 1
- low: 0.08
- medium: 0.02
- high: 0.005
Pick one clock per memory (T0 or last_decay) and use it. Days = (recall timestamp − clock) / 86400. Old 0.014 single-rate formula is out.`;

  return `PERSONA AND RULES

${personaAndRules}

AFFECT AND DECAY

${affectAndDecay}`;
}

/** Stub until a memory store exists. Do not invent salience numbers. */
function getDecayStateForTurn() {
  return "no active decay tags";
}

function buildDecayState() {
  return `CURRENT DECAY STATE: ${getDecayStateForTurn()}`;
}

function buildSessionUpdate() {
  return {
    type: "session.update",
    session: {
      voice: "eve",
      instructions: buildInstructions(),
      reasoning: { effort: "none" },
      turn_detection: { type: "server_vad" },
      audio: {
        input: {
          format: { type: "audio/pcm", rate: TARGET_RATE },
          transcription: { model: "grok-transcribe" },
        },
        output: {
          format: { type: "audio/pcm", rate: TARGET_RATE },
        },
      },
    },
  };
}

function newSessionId() {
  return crypto.randomUUID().replace(/-/g, "").slice(0, 8);
}

export class VoiceSession {
  readonly id = newSessionId();
  private phase: VoicePhase = "idle";
  private ws: WebSocket | null = null;
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private worklet: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private player: PcmPlayer | null = null;
  private logger: VoiceLogger;
  private pending: string[] = [];
  private pendingText: string[] = [];
  private rows: TranscriptRow[] = [];
  private stopped = false;
  private speechStoppedT = 0;
  private createdT = 0;
  private firstAudio = false;
  private outDeltas = 0;
  private outBytes = 0;
  private inWindow = { started: 0, chunks: 0, bytes: 0, rmsSum: 0, rmsMax: 0 };
  private by = "client";
  private decaySentForTurn = false;

  constructor(private handlers: SessionHandlers) {
    this.logger = createVoiceLogger(this.id);
  }

  async start() {
    this.setPhase("connecting");
    this.logger.log("start", { url: REALTIME_URL, target_rate: TARGET_RATE });

    const ctx = createAudioContext();
    this.ctx = ctx;
    if (ctx.state === "suspended") await ctx.resume();

    const tokenStarted = Date.now();
    let token: string;
    try {
      const response = await fetch("/api/realtime/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "ngrok-skip-browser-warning": "1",
        },
        body: JSON.stringify({ sessionId: this.id }),
      });
      const body = (await response.json()) as { token?: string; error?: string };
      if (!response.ok || !body.token) {
        throw new Error(body.error || "Could not start a voice session.");
      }
      token = body.token;
      this.logger.log("token.ok", { ms: Date.now() - tokenStarted });
    } catch (error) {
      this.logger.error("token", error, { ms: Date.now() - tokenStarted });
      this.fail(error);
      return;
    }

    const micStarted = Date.now();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: TARGET_RATE,
          channelCount: 1,
        },
      });
      const track = this.stream.getAudioTracks()[0];
      const settings = track?.getSettings() ?? {};
      this.logger.log("mic.ok", {
        ms: Date.now() - micStarted,
        label: track?.label ?? "",
        settings,
      });
    } catch (error) {
      this.logger.error("mic", error, { ms: Date.now() - micStarted });
      this.fail(error);
      return;
    }

    await addCaptureWorklet(ctx);
    this.player = new PcmPlayer(ctx, TARGET_RATE);
    this.source = ctx.createMediaStreamSource(this.stream);
    this.worklet = new AudioWorkletNode(ctx, "pcm-capture");
    this.worklet.port.onmessage = (event) => {
      this.onMic(event.data as Float32Array);
    };
    this.source.connect(this.worklet);

    this.logger.log("env", {
      ua: navigator.userAgent,
      mic_rate: this.stream.getAudioTracks()[0]?.getSettings().sampleRate ?? ctx.sampleRate,
      mic_state: this.stream.getAudioTracks()[0]?.readyState,
      play_rate: ctx.sampleRate,
      play_state: ctx.state,
      capture_frames: Math.round(ctx.sampleRate * 0.1),
      target_rate: TARGET_RATE,
    });

    this.logger.log("ws.connecting", {});
    const opened = Date.now();
    const ws = new WebSocket(REALTIME_URL, [`xai-client-secret.${token}`]);
    this.ws = ws;
    ws.binaryType = "arraybuffer";

    ws.addEventListener("open", () => {
      this.logger.log("ws.open", { ms: Date.now() - opened });
      this.send(buildSessionUpdate());
      if (this.pending.length) {
        this.logger.log("audio.flush", { chunks: this.pending.length });
        for (const audio of this.pending) {
          this.send({ type: "input_audio_buffer.append", audio }, true);
        }
        this.pending = [];
      }
      const sentText = this.flushPendingText();
      if (!sentText) this.setPhase("listening");
    });

    ws.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      let payload: Record<string, unknown>;
      try {
        payload = JSON.parse(event.data) as Record<string, unknown>;
      } catch (error) {
        this.logger.error("parse", error);
        return;
      }
      this.onServer(payload);
    });

    ws.addEventListener("error", () => {
      this.logger.log("ws.error", {});
    });

    ws.addEventListener("close", (event) => {
      this.logger.log("ws.close", {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
        by: this.by,
      });
      if (!this.stopped) {
        this.fail(new Error(`Voice closed (${event.code}).`));
      }
    });
  }

  sendText(text: string) {
    const trimmed = text.trim();
    if (!trimmed || this.stopped) return;
    this.upsert({ id: crypto.randomUUID(), role: "user", text: trimmed });
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.pendingText.push(trimmed);
      return;
    }
    this.emitText(trimmed);
  }

  stop(by: "client" | "error" = "client") {
    if (this.stopped) return;
    this.stopped = true;
    this.by = by;
    this.logger.log("stop", { by, phase: this.phase });
    this.flushInWindow(true);
    this.player?.stop();
    this.worklet?.port.close();
    this.worklet?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    try {
      this.ws?.close();
    } catch {
      // ignore
    }
    void this.ctx?.close();
    this.logger.close();
    this.setPhase("idle");
  }

  private onMic(frame: Float32Array) {
    if (this.stopped || !this.ctx) return;
    const micRate = this.stream?.getAudioTracks()[0]?.getSettings().sampleRate ?? this.ctx.sampleRate;
    const resampled = resample(frame, micRate, TARGET_RATE);
    const pcm = floatToPcm16(resampled);
    const audio = pcm16ToBase64(pcm.bytes);
    this.noteIn(pcm.bytes.length, pcm.rms);

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (this.pending.length < PREOPEN_CAP) this.pending.push(audio);
      return;
    }
    this.send({ type: "input_audio_buffer.append", audio }, true);
  }

  private onServer(event: Record<string, unknown>) {
    const type = typeof event.type === "string" ? event.type : "";
    const audioDelta =
      type === "response.output_audio.delta" || type === "response.audio.delta";

    if (audioDelta) {
      this.onAudioDelta(event);
      return;
    }

    this.logger.server(event, { phase: this.phase });

    switch (type) {
      case "input_audio_buffer.speech_started":
        this.decaySentForTurn = false;
        if (this.phase === "speaking") {
          const dropped = this.player?.stop() ?? 0;
          this.logger.log("play.stop", { reason: "barge-in", dropped_ms: dropped });
        }
        this.setPhase("listening");
        break;
      case "input_audio_buffer.speech_stopped":
        this.speechStoppedT = Date.now();
        this.refreshDecayState();
        this.setPhase("thinking");
        break;
      case "input_audio_buffer.committed": {
        const itemId = typeof event.item_id === "string" ? event.item_id : crypto.randomUUID();
        this.upsert({ id: itemId, role: "user", text: "" });
        this.refreshDecayState();
        break;
      }
      case "conversation.item.input_audio_transcription.updated": {
        const itemId = typeof event.item_id === "string" ? event.item_id : "";
        const transcript = typeof event.transcript === "string" ? event.transcript : "";
        if (itemId) this.upsert({ id: itemId, role: "user", text: transcript });
        break;
      }
      case "response.created":
        this.createdT = Date.now();
        this.firstAudio = false;
        this.outDeltas = 0;
        this.outBytes = 0;
        this.player?.resetTurn();
        break;
      case "response.output_audio_transcript.delta": {
        const delta = typeof event.delta === "string" ? event.delta : "";
        const responseId = typeof event.response_id === "string" ? event.response_id : "assistant";
        const existing = this.rows.find((row) => row.id === responseId);
        this.upsert({
          id: responseId,
          role: "assistant",
          text: `${existing?.text ?? ""}${delta}`,
        });
        break;
      }
      case "response.output_audio_transcript.done": {
        const transcript = typeof event.transcript === "string" ? event.transcript : "";
        const responseId = typeof event.response_id === "string" ? event.response_id : "assistant";
        if (transcript) this.upsert({ id: responseId, role: "assistant", text: transcript });
        break;
      }
      case "response.done": {
        const response = (event.response ?? {}) as Record<string, unknown>;
        const responseId = typeof response.id === "string" ? response.id : "";
        this.logger.log("audio.out", {
          response_id: responseId,
          status: response.status,
          deltas: this.outDeltas,
          bytes: this.outBytes,
          audio_ms: this.outBytes > 0 ? Math.round((this.outBytes / 2 / TARGET_RATE) * 1000) : 0,
          wall_ms: this.createdT ? Date.now() - this.createdT : 0,
          max_gap_ms: this.player?.maxGapMs ?? 0,
          queued_ms: this.player?.queuedMs ?? 0,
          underruns: this.player?.underruns ?? 0,
          drain_ms_max: this.player?.drainMsMax ?? 0,
        });
        this.decaySentForTurn = false;
        this.setPhase("listening");
        break;
      }
      case "error": {
        const message =
          typeof event.message === "string" ? event.message : "Voice session error.";
        this.fail(new Error(message));
        break;
      }
      default:
        break;
    }
  }

  private onAudioDelta(event: Record<string, unknown>) {
    const raw = typeof event.delta === "string" ? event.delta : typeof event.audio === "string" ? event.audio : "";
    if (!raw || !this.player) return;
    const bytes = base64ToBytes(raw);
    this.outDeltas += 1;
    this.outBytes += bytes.byteLength;
    if (!this.firstAudio) {
      this.firstAudio = true;
      const responseId = typeof event.response_id === "string" ? event.response_id : "";
      this.logger.log("audio.out.first", {
        response_id: responseId,
        bytes: bytes.byteLength,
        since_response_created_ms: this.createdT ? Date.now() - this.createdT : 0,
        since_speech_stopped_ms: this.speechStoppedT ? Date.now() - this.speechStoppedT : 0,
        play_state: this.player.state,
      });
      this.setPhase("speaking");
    }
    this.player.play(bytes);
  }

  private refreshDecayState() {
    if (this.stopped || this.decaySentForTurn) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.decaySentForTurn = true;
    const text = buildDecayState();
    this.logger.log("decay.refresh", { text });
    // Per-turn payload is decay only. session.update would replace instructions
    // wholesale and resend the persona; attach a small context item instead.
    this.send(
      {
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text }],
        },
      },
      true,
    );
  }

  private emitText(text: string) {
    this.decaySentForTurn = false;
    this.refreshDecayState();
    this.send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    });
    this.send({ type: "response.create" });
    this.setPhase("thinking");
  }

  private flushPendingText() {
    if (!this.pendingText.length) return false;
    const queued = this.pendingText.splice(0);
    this.logger.log("text.flush", { messages: queued.length });
    this.decaySentForTurn = false;
    this.refreshDecayState();
    for (const text of queued) {
      this.send({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text }],
        },
      });
    }
    this.send({ type: "response.create" });
    this.setPhase("thinking");
    return true;
  }

  private send(event: Record<string, unknown>, silent = false) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!silent) this.logger.client(event);
    this.ws.send(JSON.stringify(event));
  }

  private noteIn(bytes: number, rms: number) {
    const now = Date.now();
    if (!this.inWindow.started) this.inWindow.started = now;
    this.inWindow.chunks += 1;
    this.inWindow.bytes += bytes;
    this.inWindow.rmsSum += rms;
    this.inWindow.rmsMax = Math.max(this.inWindow.rmsMax, rms);
    if (now - this.inWindow.started >= 2000) this.flushInWindow();
  }

  private flushInWindow(force = false) {
    if (!this.inWindow.started || (!force && this.inWindow.chunks === 0)) return;
    this.logger.log("audio.in", {
      chunks: this.inWindow.chunks,
      bytes: this.inWindow.bytes,
      rms_max: this.inWindow.rmsMax,
      rms_avg: this.inWindow.chunks ? this.inWindow.rmsSum / this.inWindow.chunks : 0,
      pending: this.pending.length,
      mic_state: this.stream?.getAudioTracks()[0]?.readyState,
      phase: this.phase,
    });
    this.inWindow = { started: 0, chunks: 0, bytes: 0, rmsSum: 0, rmsMax: 0 };
  }

  private upsert(row: TranscriptRow) {
    const index = this.rows.findIndex((item) => item.id === row.id);
    if (index >= 0) this.rows[index] = { ...this.rows[index], ...row };
    else this.rows = [...this.rows, row];
    this.handlers.onTranscripts(this.rows);
  }

  private setPhase(phase: VoicePhase) {
    if (this.phase === phase) return;
    this.phase = phase;
    this.logger.log("phase", { phase });
    this.handlers.onPhase(phase);
  }

  private fail(error: unknown) {
    const message = error instanceof Error ? error.message : "Voice session failed.";
    this.handlers.onError(`${message} (voice session ${this.id})`);
    this.stop("error");
  }
}
