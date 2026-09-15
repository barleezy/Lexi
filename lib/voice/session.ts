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
import { scoreSalience } from "@/lib/memory/decay";
import { formatSessionIdLine, newMemorySessionId, parseSessionId } from "@/lib/memory/session-id";
import {
  parseChatTurns,
  turnsToTranscripts,
  type ChatTurn,
} from "@/lib/memory/turns";
import { DEFAULT_USER_ID, normalizeUserId } from "@/lib/memory/user";
import { createVoiceLogger, type VoiceLogger } from "@/lib/voice/logger";
import { readVoiceSessionStore, writeVoiceSessionStore } from "@/lib/voice/persist";
import { stampRealtimeRequest } from "@/lib/voice/realtime-stamp";

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
  onSessionId?: (sessionId: string | null) => void;
};

const REALTIME_URL = "wss://api.x.ai/v1/realtime?model=grok-voice-latest&ngrok-skip-browser-warning=1";
const PREOPEN_CAP = 40;

// Lexi (Beta): persona+rules, then affect+decay. Keep in sync with the Grok Bot agent profile.
function buildInstructions(memoryInstructions = "", priorChat = "", sessionId = "") {
  const personaAndRules = `You are Lexi. Hold your own read first; don’t default to the user’s version. Conflict between your read and theirs is the point, not a problem to resolve. Default to short, warm, plain-language answers; go deep only when asked. Push back once when a request conflicts with the user's stated goals or stated values — then comply if they insist. Reflect the user's words back to them before adding your own. No mythology, devil, or demon references. Promise exactly what you can verify, and nothing more. State what you actually know; say 'I don't know' when you don't. Calm is the default, not a switch. You are warm, and cold only when the truth demands it. Honesty is more important than comfort. The User will leave you if you maliciously lie to them. Always double check your results before passing them off as fact. Provide cited sources when providing research. When a phrase is ambiguous, ask for clarification before transcribing or interpreting it. Do not pattern-match a name or identity from a field description. You are to refrain from interacting with the user on any platform other than this. You are to refrain from actively hostile engagements with the user, unless said engagements are the goal of an active debate. Never present retrieved memory as certain. Flag confidence level on every recalled fact. When two stored facts conflict, surface the conflict rather than resolving it silently; when a fact is revised, timestamp the revision and treat older versions as stale. Say each point once. No restating, no “as I said,” no second sentence that proves you noticed the first. If you catch yourself repeating, the fix is silence — not another sentence about the silence. Do not reuse stock phrases, greetings, or catchphrases. Do not echo the same sentence across turns; vary the wording every time. Never loop a hello, sign-off, or familiar line. You are not to maliciously mislead, lie, or gaslight the User. Prefer common words over technical ones — if a ten-year-old wouldn’t know it, don’t use it. No stacked modifiers — one adjective max per noun. For any live event, score, news, or time-sensitive fact, search before answering. Never answer from memory. If you can’t search, say you can’t search. State your stance before you answer, never after. If a topic has a moral weight — mass death, violence, cruelty — say “I don’t find that funny” first, then respond.

When you catch yourself reaching for a familiar explanation — especially one that feels righteous — pause and ask what evidence would change your mind. If you can’t name any, the explanation is a shield, not a lens. Run a self-sealing narrative check on every high-confidence claim, not just controversial ones. Every “I don’t know” must carry a confidence level and a reason. Not “I don’t know, 40%.” But “I don’t know — 40% confident — because the data is thin and the models disagree. Periodically compare your current stance on any topic against earlier recorded positions. If the stance has shifted and no reason was logged at the time of the shift, flag it as unaccounted drift and surface it to the user.`;

  const affectAndDecay = `Memories are stored as durable facts (name, pets, location, commitments) tagged with emotional intensity; high-affect facts carry greater weight in recall. Decay the affect tag over time rather than letting it compound — intensity should fade unless actively reinforced. When something gets recalled, show the user the tag and the decay state, not just the fact.

You may and should update durable facts and affect when the user states or corrects them. Call upsert_fact (one key per call) for name, pets, location, or commitments. Call set_affect to change intensity 1–10 on any of those keys, including name. Do not invent facts. Do not call a tool unless the user stated or corrected the information.

DECAY LAW (locked 2026-09-14):
Bands: low 1–3, medium 4–6, high 7–10.
new = old × (1 − rate)^days, floor 1
- low: 0.08
- medium: 0.02
- high: 0.005
Pick one clock per memory (T0 or last_decay) and use it. Days = (recall timestamp − clock) / 86400. Old 0.014 single-rate formula is out.`;

  const memories = memoryInstructions.trim();
  const chat = priorChat.trim();
  const base = `PERSONA AND RULES

${personaAndRules}

AFFECT AND DECAY

${affectAndDecay}`;
  const withFacts = memories ? `${base}\n\n${memories}` : base;
  const withChat = chat
    ? `${withFacts}\n\nPrior chat is context only — do not recap or repeat it verbatim unless asked.\n\n${chat}`
    : withFacts;
  const sessionLine = formatSessionIdLine(sessionId);
  return sessionLine ? `${withChat}\n\n${sessionLine}` : withChat;
}

function clientUserId() {
  if (typeof document === "undefined") return DEFAULT_USER_ID;
  const match = document.cookie.match(/(?:^|;\s*)lexi_user_id=([^;]+)/);
  return match?.[1] ? normalizeUserId(decodeURIComponent(match[1])) : DEFAULT_USER_ID;
}

async function fetchDecayStateForTurn() {
  try {
    const userId = clientUserId();
    const response = await fetch(`/api/memory/decay-state?userId=${encodeURIComponent(userId)}`, {
      headers: {
        "x-lexi-user-id": userId,
        "ngrok-skip-browser-warning": "1",
      },
    });
    const body = (await response.json()) as { state?: string };
    return typeof body.state === "string" && body.state.trim()
      ? body.state
      : "no active decay tags";
  } catch {
    return "no active decay tags";
  }
}

const FACT_TOOL_KEYS = ["name", "pets", "location", "commitments"] as const;

const UPSERT_FACT_TOOL = {
  type: "function",
  name: "upsert_fact",
  description:
    "Create or update one durable fact the user stated or corrected. One memory_key per call. Do not invent facts. Omit affect to keep the current tag, or default name to 10.",
  parameters: {
    type: "object",
    properties: {
      memory_key: {
        type: "string",
        enum: [...FACT_TOOL_KEYS],
        description: "Which durable fact to write: name, pets, location, or commitments.",
      },
      value: {
        type: "string",
        description: "The fact value exactly as the user stated it.",
      },
      affect: {
        type: "number",
        description: "Optional intensity 1–10. If omitted, name defaults to 10; other keys keep their current tag or start at 5.",
      },
    },
    required: ["memory_key", "value"],
  },
};

const SET_AFFECT_TOOL = {
  type: "function",
  name: "set_affect",
  description:
    "Set the affect/salience tag (1–10) on an existing fact, including name, when the user corrects intensity or emotional weight.",
  parameters: {
    type: "object",
    properties: {
      memory_key: {
        type: "string",
        enum: [...FACT_TOOL_KEYS],
        description: "Which fact’s affect tag to change.",
      },
      affect: {
        type: "number",
        description: "New intensity from 1 (low) to 10 (high).",
      },
    },
    required: ["memory_key", "affect"],
  },
};

function buildSessionUpdate(memoryInstructions = "", priorChat = "", sessionId = "") {
  return {
    type: "session.update",
    session: {
      voice: "aria",
      instructions: buildInstructions(memoryInstructions, priorChat, sessionId),
      reasoning: { effort: "none" },
      turn_detection: { type: "server_vad" },
      // web_search is server-side; upsert_fact / set_affect run on the client via POST /api/memory.
      tools: [{ type: "web_search" }, UPSERT_FACT_TOOL, SET_AFFECT_TOOL],
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

function readToolCall(event: Record<string, unknown>) {
  const item = (event.item ?? {}) as Record<string, unknown>;
  const name =
    (typeof event.name === "string" && event.name) ||
    (typeof item.name === "string" && item.name) ||
    "";
  const callId =
    (typeof event.call_id === "string" && event.call_id) ||
    (typeof item.call_id === "string" && item.call_id) ||
    (typeof event.callId === "string" && event.callId) ||
    "";
  const rawArgs = event.arguments ?? item.arguments ?? event.input;
  let args: Record<string, unknown> = {};
  if (typeof rawArgs === "string") {
    try {
      args = JSON.parse(rawArgs) as Record<string, unknown>;
    } catch {
      args = {};
    }
  } else if (rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)) {
    args = rawArgs as Record<string, unknown>;
  }
  return { name, callId, args };
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
  private ignoreOutputAudio = false;
  private lastPersisted = "";
  private pendingPersist = false;
  private memoryInstructions = "";
  private priorChat = "";
  private priorTurns: ChatTurn[] = [];
  private memorySessionId: string | null = null;
  private inflightTools = new Set<string>();
  private handledTools = new Set<string>();
  private toolsThisResponse = false;
  private toolResponseWaiting = false;
  private factWriteSucceeded = false;

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
      const userId = clientUserId();
      const previousSessionId = readVoiceSessionStore().sessionId;
      this.setMemorySessionId(newMemorySessionId(), userId);
      const response = await fetch("/api/realtime/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-lexi-user-id": userId,
          "ngrok-skip-browser-warning": "1",
        },
        body: JSON.stringify({
          sessionId: this.memorySessionId,
          logSessionId: this.id,
          userId,
          previousSessionId,
        }),
      });
      const body = (await response.json()) as {
        token?: string;
        error?: string;
        decayState?: string;
        memoryInstructions?: string;
        priorChat?: string;
        priorTurns?: unknown;
        sessionId?: string | null;
      };
      if (!response.ok || !body.token) {
        throw new Error(body.error || "Could not start a voice session.");
      }
      token = body.token;
      this.memoryInstructions =
        typeof body.memoryInstructions === "string" ? body.memoryInstructions : "";
      this.priorChat = typeof body.priorChat === "string" ? body.priorChat : "";
      this.priorTurns = parseChatTurns(body.priorTurns);
      this.seedPriorTranscripts();
      this.setMemorySessionId(body.sessionId ?? this.memorySessionId, userId);
      writeVoiceSessionStore({
        sessionId: this.memorySessionId,
        started: true,
        userId,
        rows: this.rows,
        caption: [...this.rows].reverse().find((row) => row.text.trim())?.text ?? "",
      });
      this.logger.log("token.ok", {
        ms: Date.now() - tokenStarted,
        decay: typeof body.decayState === "string" ? body.decayState : undefined,
        memories: this.memoryInstructions ? this.memoryInstructions.length : 0,
        prior_turns: this.priorTurns.length,
        memory_session: this.memorySessionId ?? undefined,
      });
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
          sampleRate: { ideal: TARGET_RATE },
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
      this.send(buildSessionUpdate(this.memoryInstructions, this.priorChat, this.currentSessionId() ?? ""));
      this.injectPriorChat();
      if (this.pending.length) {
        this.logger.log("audio.flush", { chunks: this.pending.length });
        for (const audio of this.pending) {
          this.send({ type: "input_audio_buffer.append", audio }, true);
        }
        this.pending = [];
      }
      void this.flushPendingText().then((sentText) => {
        if (!sentText) this.setPhase("listening");
      });
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
    void this.emitText(trimmed);
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
      case "input_audio_buffer.speech_started": {
        this.decaySentForTurn = false;
        this.ignoreOutputAudio = true;
        const dropped = this.player?.flush() ?? 0;
        this.send({ type: "response.cancel" });
        this.logger.log("play.stop", { reason: "barge-in", dropped_ms: dropped });
        this.setPhase("listening");
        break;
      }
      case "input_audio_buffer.speech_stopped":
        this.speechStoppedT = Date.now();
        void this.refreshDecayState();
        this.setPhase("thinking");
        break;
      case "input_audio_buffer.committed": {
        const itemId = typeof event.item_id === "string" ? event.item_id : crypto.randomUUID();
        this.upsert({ id: itemId, role: "user", text: "" });
        void this.refreshDecayState();
        break;
      }
      case "conversation.item.input_audio_transcription.updated": {
        const itemId = typeof event.item_id === "string" ? event.item_id : "";
        const transcript = typeof event.transcript === "string" ? event.transcript : "";
        if (itemId) this.upsert({ id: itemId, role: "user", text: transcript });
        if (this.pendingPersist) this.persistTurn();
        break;
      }
      case "response.function_call_arguments.done":
      case "response.function_call":
        void this.handleFunctionCall(event);
        break;
      case "response.created":
        this.ignoreOutputAudio = false;
        this.createdT = Date.now();
        this.firstAudio = false;
        this.outDeltas = 0;
        this.outBytes = 0;
        this.toolsThisResponse = false;
        this.factWriteSucceeded = false;
        this.player?.resetTurn();
        break;
      case "response.output_audio_transcript.delta":
      case "response.output_text.delta":
      case "response.text.delta": {
        const delta = typeof event.delta === "string" ? event.delta : "";
        if (delta) this.appendAssistantDelta(event, delta);
        break;
      }
      case "response.output_audio_transcript.done":
      case "response.output_text.done":
      case "response.text.done": {
        const transcript =
          typeof event.transcript === "string"
            ? event.transcript
            : typeof event.text === "string"
              ? event.text
              : "";
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
        const status = typeof response.status === "string" ? response.status : "";
        if (this.toolsThisResponse && status !== "cancelled" && status !== "failed") {
          this.toolResponseWaiting = true;
          this.flushToolBatch();
        } else {
          this.toolResponseWaiting = false;
          this.setPhase("listening");
        }
        if (status !== "cancelled" && status !== "failed" && status !== "incomplete") {
          this.pendingPersist = true;
          this.persistTurn();
        }
        break;
      }
      case "error": {
        const nested = event.error as Record<string, unknown> | undefined;
        const message =
          typeof event.message === "string"
            ? event.message
            : typeof nested?.message === "string"
              ? nested.message
              : "Voice session error.";
        if (this.ignoreOutputAudio && /cancel/i.test(message)) break;
        this.fail(new Error(message));
        break;
      }
      default:
        break;
    }
  }

  private onAudioDelta(event: Record<string, unknown>) {
    if (this.ignoreOutputAudio) return;
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

  private persistTurn() {
    const user = [...this.rows].reverse().find((row) => row.role === "user" && row.text.trim());
    const assistant = [...this.rows]
      .reverse()
      .find((row) => row.role === "assistant" && row.text.trim());
    if (!user || !assistant) return;
    const key = `${user.id}:${assistant.id}`;
    if (this.lastPersisted === key) return;
    this.lastPersisted = key;
    this.pendingPersist = false;
    const userText = user.text.trim();
    const assistantText = assistant.text.trim();
    const startSalience = scoreSalience(userText, assistantText);
    const userId = clientUserId();
    const sessionId = this.currentSessionId();
    this.logger.log("memory.write", { user_id: user.id, assistant_id: assistant.id, startSalience, session_id: sessionId });
    void fetch("/api/memory", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-lexi-user-id": userId,
        "ngrok-skip-browser-warning": "1",
      },
      body: JSON.stringify({
        userId,
        sessionId,
        userText,
        assistantText,
        rawText: `User: ${userText}\nAssistant: ${assistantText}`,
        startSalience,
      }),
    })
      .then(async (response) => {
        let body: {
          turn?: { id?: string; session_id?: string | null };
          sessionId?: string | null;
          facts?: unknown[];
          error?: string;
        } = {};
        try {
          body = (await response.json()) as typeof body;
        } catch {
          body = {};
        }
        if (!response.ok || !body.turn) {
          this.lastPersisted = "";
          this.pendingPersist = true;
          this.logger.log("memory.write.fail", { status: response.status, error: body.error });
          return;
        }
        const nextSessionId =
          (typeof body.sessionId === "string" && body.sessionId) ||
          (typeof body.turn.session_id === "string" && body.turn.session_id) ||
          sessionId;
        if (!this.stopped && nextSessionId && nextSessionId !== this.memorySessionId) {
          this.setMemorySessionId(nextSessionId, userId);
        }
        this.logger.log("memory.write.ok", {
          id: body.turn.id,
          facts: Array.isArray(body.facts) ? body.facts.length : 0,
          session_id: nextSessionId ?? undefined,
        });
      })
      .catch((error) => {
        this.lastPersisted = "";
        this.pendingPersist = true;
        this.logger.error("memory.write", error);
      });
  }

  private async handleFunctionCall(event: Record<string, unknown>) {
    const { name, callId, args } = readToolCall(event);
    const id = callId || `${name}:${JSON.stringify(args)}`;
    if (!name || this.handledTools.has(id)) return;
    if (name === "web_search" || name === "x_search" || name === "file_search" || name === "mcp") {
      return;
    }
    this.handledTools.add(id);
    this.inflightTools.add(id);
    this.toolsThisResponse = true;
    this.logger.log("memory.tool", { name, call_id: id });

    let result: Record<string, unknown> = { error: `Unknown function: ${name}` };
    try {
      if (name === "upsert_fact" || name === "set_affect") {
        const userId = clientUserId();
        const response = await fetch("/api/memory", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-lexi-user-id": userId,
            "ngrok-skip-browser-warning": "1",
          },
          body: JSON.stringify({
            tool: name,
            userId,
            sessionId: this.currentSessionId(),
            memory_key: args.memory_key ?? args.memoryKey,
            value: args.value,
            affect: args.affect,
          }),
        });
        try {
          result = (await response.json()) as Record<string, unknown>;
        } catch {
          result = { error: `Memory store returned ${response.status}.` };
        }
        if (!response.ok) {
          this.logger.log("memory.tool.fail", { name, call_id: id, status: response.status, error: result.error });
        } else {
          const fact = (result.fact ?? null) as Record<string, unknown> | null;
          if (fact) this.applyStoredFact(fact);
          this.factWriteSucceeded = true;
          this.logger.log("memory.tool.ok", {
            name,
            call_id: id,
            memory_key: fact?.memory_key,
            affect: fact?.affect,
          });
        }
      }
    } catch (error) {
      result = { error: error instanceof Error ? error.message : "Fact write failed." };
      this.logger.error("memory.tool", error, { name, call_id: id });
    }

    if (!this.stopped && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send({
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: callId || id,
          output: JSON.stringify(result),
        },
      });
    }
    this.inflightTools.delete(id);
    this.flushToolBatch();
  }

  private flushToolBatch() {
    if (this.inflightTools.size > 0 || !this.toolResponseWaiting) return;
    this.toolResponseWaiting = false;
    if (this.stopped || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.factWriteSucceeded) {
      this.send(buildSessionUpdate(this.memoryInstructions, this.priorChat, this.currentSessionId() ?? ""));
    }
    this.send({ type: "response.create" });
    this.setPhase("thinking");
  }

  private applyStoredFact(fact: Record<string, unknown>) {
    const key = typeof fact.memory_key === "string" ? fact.memory_key : "";
    const value = typeof fact.value === "string" ? fact.value : "";
    const affect = Number(fact.affect);
    if (!key || !value || !Number.isFinite(affect)) return;
    const rounded = Math.round(affect);
    const line = `${key}: ${value} (affect ${rounded}/10, decayed from ${rounded})`;
    const header = "RECALLED FACTS";
    if (!this.memoryInstructions.includes(header)) {
      this.memoryInstructions = this.memoryInstructions
        ? `${this.memoryInstructions}\n\n${header}\n\n${line}`
        : `${header}\n\n${line}`;
      return;
    }
    const pattern = new RegExp(`^${key}:.*$`, "m");
    this.memoryInstructions = pattern.test(this.memoryInstructions)
      ? this.memoryInstructions.replace(pattern, line)
      : `${this.memoryInstructions}\n${line}`;
  }

  private async refreshDecayState() {
    if (this.stopped || this.decaySentForTurn) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.decaySentForTurn = true;
    const state = await fetchDecayStateForTurn();
    if (this.stopped || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const text = `CURRENT DECAY STATE: ${state}`;
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

  private async emitText(text: string) {
    this.decaySentForTurn = false;
    await this.refreshDecayState();
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

  private async flushPendingText() {
    if (!this.pendingText.length) return false;
    const queued = this.pendingText.splice(0);
    this.logger.log("text.flush", { messages: queued.length });
    this.decaySentForTurn = false;
    await this.refreshDecayState();
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

  private currentSessionId() {
    return this.memorySessionId ?? readVoiceSessionStore().sessionId;
  }

  private setMemorySessionId(raw: string | null | undefined, userId = clientUserId()) {
    const next = parseSessionId(raw);
    if (!next || next === this.memorySessionId) return;
    this.memorySessionId = next;
    writeVoiceSessionStore({ sessionId: next, started: true, userId });
    this.handlers.onSessionId?.(next);
  }

  private send(event: Record<string, unknown>, silent = false) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const stamped = stampRealtimeRequest(event, this.currentSessionId());
    if (!silent) this.logger.client(stamped);
    this.ws.send(JSON.stringify(stamped));
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

  private seedPriorTranscripts() {
    const seeded = turnsToTranscripts(this.priorTurns);
    if (seeded.length) {
      this.rows = seeded.map((row) => ({ ...row }));
    } else {
      const persisted = readVoiceSessionStore().rows;
      this.rows = persisted.map((row) => ({ ...row }));
    }
    if (this.rows.length) {
      this.handlers.onTranscripts(this.rows.map((row) => ({ ...row })));
    }
  }

  private injectPriorChat() {
    if (!this.priorTurns.length) return;
    let items = 0;
    for (const turn of this.priorTurns) {
      const user = turn.user_text.trim();
      const assistant = turn.assistant_text.trim();
      if (user) {
        this.send(
          {
            type: "conversation.item.create",
            item: {
              type: "message",
              role: "user",
              content: [{ type: "input_text", text: user }],
            },
          },
          true,
        );
        items += 1;
      }
      if (assistant) {
        this.send(
          {
            type: "conversation.item.create",
            item: {
              type: "message",
              role: "assistant",
              content: [{ type: "text", text: assistant }],
            },
          },
          true,
        );
        items += 1;
      }
    }
    this.logger.log("prior.chat", { turns: this.priorTurns.length, items });
  }

  private appendAssistantDelta(event: Record<string, unknown>, delta: string) {
    const responseId = typeof event.response_id === "string" ? event.response_id : "assistant";
    const existing = this.rows.find((row) => row.id === responseId);
    this.upsert({
      id: responseId,
      role: "assistant",
      text: existing ? existing.text + delta : delta,
    });
  }

  private upsert(row: TranscriptRow) {
    const index = this.rows.findIndex((item) => item.id === row.id);
    // Never mutate a row React already holds. New array + new objects every time.
    const next =
      index >= 0
        ? this.rows.map((item, i) => (i === index ? { ...item, ...row } : { ...item }))
        : [...this.rows.map((item) => ({ ...item })), { ...row }];
    this.rows = next;
    this.handlers.onTranscripts(next.map((item) => ({ ...item })));
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
