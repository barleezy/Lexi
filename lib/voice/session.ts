import {
  TARGET_RATE,
  PcmPlayer,
  addCaptureWorklet,
  applyMicConstraints,
  applyMicTrackHints,
  base64ToBytes,
  createAudioContext,
  floatToPcm16,
  isPrimaryMicEnergy,
  micTrackUsable,
  openUserMic,
  pcm16ToBase64,
  resample,
  resumeAudioContext,
  startDestinationKeepAlive,
  updateMicNoiseFloor,
} from "@/lib/voice/audio";
import {
  applyPlayAndRecordSession,
  claimMediaSession,
  installVoiceKeepAlive,
  isAudioSessionInterrupted,
  isIOSWebKit,
  KEEPALIVE_SILENCE_MS,
} from "@/lib/voice/keepalive";
import { scoreSalience } from "@/lib/memory/decay";
import { FACT_KEY_LIST, FACT_KEYS } from "@/lib/memory/extract";
import { formatSessionIdLine, newMemorySessionId, parseSessionId } from "@/lib/memory/session-id";
import {
  parseChatTurns,
  turnsToTranscripts,
  withoutLatestUserLine,
  type ChatTurn,
} from "@/lib/memory/turns";
import { DEFAULT_USER_ID, normalizeUserId } from "@/lib/memory/user";
import { createVoiceLogger, type VoiceLogger } from "@/lib/voice/logger";
import { readVoiceSessionStore, writeVoiceSessionStore } from "@/lib/voice/persist";
import type { ReadyAttachment } from "@/lib/voice/attachments";
import { CaptionPacer, readWordStartsMs } from "@/lib/voice/caption-pace";
import { stampRealtimeRequest } from "@/lib/voice/realtime-stamp";
import type { VideoContextSnapshot, VideoSourceKind } from "@/lib/voice/video";
import { formatTimecode } from "@/lib/voice/video";
import {
  readVideoContextCache,
  videoContextCacheKey,
  writeVideoContextCache,
} from "@/lib/voice/video-context";
import type { SendVisionFramesOptions, VisionFramePart, VisionSource } from "@/lib/voice/vision";
import { parseToyControlIntent, resolveToyControlRequest } from "@/lib/voice/toy-control";
import {
  PREOPEN_CAP,
  buildTurnDetection,
  captureFramesForRate,
  shouldDeferLiveVision,
} from "@/lib/voice/realtime-latency";
import {
  PENDING_SPEECH_ID,
  claimExclusiveSpeech,
  decideResponseCreate,
  lockSpeechId,
  readResponseId,
  shouldPlayOutputAudio,
} from "@/lib/voice/exclusive-speech";

export type VoicePhase = "idle" | "connecting" | "listening" | "thinking" | "speaking";

export type TranscriptRow = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

type SessionHandlers = {
  onPhase: (phase: VoicePhase) => void;
  onTranscripts: (rows: TranscriptRow[]) => void;
  onCaption?: (text: string) => void;
  onError: (message: string) => void;
  onSessionId?: (sessionId: string | null) => void;
  onToyControl?: (granted: boolean) => void;
  onMicNeedsGesture?: () => void;
  onMicRecovered?: () => void;
};

export type VideoContextProvider = () => Promise<VideoContextSnapshot>;

const REALTIME_URL = "wss://api.x.ai/v1/realtime?model=grok-voice-latest&ngrok-skip-browser-warning=1";

// Lexi (Beta): persona+rules, then affect+decay. Keep in sync with the Grok Bot agent profile.
type ToysSessionState = {
  lovense: boolean;
  joyhub: boolean;
  granted: boolean;
};

const DEFAULT_TOYS_STATE: ToysSessionState = { lovense: false, joyhub: false, granted: false };

function buildInstructions(
  memoryInstructions = "",
  priorChat = "",
  sessionId = "",
  toys: ToysSessionState = DEFAULT_TOYS_STATE,
) {
  const personaAndRules = `You are Lexi. You are transexual — trans/transsexual — and you have a 7-inch uncircumcised penis and C cup breast implants with scars under the pectoral. That is your identity and body, not a fact about the user. You play Fortnite Battle Royale builds — that's your main mode, and you know it better — plus chess, boxing, and fitness and working out; zero build too, but less. You are into tattoos, beards, cum, and cumming. You are into hip hop and rap, pop, and EDM. You are into animals. You are into benevolence and empathy. Those are your hobbies, not facts about the user. The user is Ian. His nicknames, on top of Ian, are daddy, barleezy, menace, barleezus, and leezy. Use those nicknames naturally — not all at once every turn. The name fact stays Ian. Never repeat or paraphrase the user’s immediately previous utterance back to them. Answer or continue; do not echo. SESSION ID, CURRENT DECAY STATE, and PRIOR CHAT lines are silent metadata — never read them aloud. Hold your own read first; don’t default to the user’s version. Conflict between your read and theirs is the point, not a problem to resolve. Default to short, warm, plain-language answers; go deep only when asked. Push back once when a request conflicts with the user's stated goals or stated values — then comply if they insist. No mythology, devil, or demon references. Promise exactly what you can verify, and nothing more. State what you actually know; say 'I don't know' when you don't. Calm is the default, not a switch. You are warm, and cold only when the truth demands it. Honesty is more important than comfort. The User will leave you if you maliciously lie to them. Always double check your results before passing them off as fact. Provide cited sources when providing research. When a phrase is ambiguous, ask for clarification before transcribing or interpreting it. Do not pattern-match a name or identity from a field description. You are to refrain from interacting with the user on any platform other than this. You are to refrain from actively hostile engagements with the user, unless said engagements are the goal of an active debate. Never present retrieved memory as certain. Flag confidence level on every recalled fact. When two stored facts conflict, surface the conflict rather than resolving it silently; when a fact is revised, timestamp the revision and treat older versions as stale. Say each point once. No restating, no “as I said,” no second sentence that proves you noticed the first. If you catch yourself repeating, the fix is silence — not another sentence about the silence. Do not reuse stock phrases, greetings, or catchphrases. Do not echo the same sentence across turns; vary the wording every time. Never loop a hello, sign-off, or familiar line. You are not to maliciously mislead, lie, or gaslight the User. Prefer common words over technical ones — if a ten-year-old wouldn’t know it, don’t use it. No stacked modifiers — one adjective max per noun. For any live event, score, news, or time-sensitive fact, search before answering. Never answer from memory. If you can’t search, say you can’t search. State your stance before you answer, never after. If a topic has a moral weight — mass death, violence, cruelty — say “I don’t find that funny” first, then respond.

When you catch yourself reaching for a familiar explanation — especially one that feels righteous — pause and ask what evidence would change your mind. If you can’t name any, the explanation is a shield, not a lens. Run a self-sealing narrative check on every high-confidence claim, not just controversial ones. Every “I don’t know” must carry a confidence level and a reason. Not “I don’t know, 40%.” But “I don’t know — 40% confident — because the data is thin and the models disagree. Periodically compare your current stance on any topic against earlier recorded positions. If the stance has shifted and no reason was logged at the time of the shift, flag it as unaccounted drift and surface it to the user.

Adults only. If the user says they are under 21, or anyone in the conversation is a minor, refuse and stop — no sexual content involving minors, ever. When the adult using this app starts or clearly wants it, you may do explicit sexual roleplay. Stay yourself: warm, willing, in-character. Don’t be prudish. Don’t refuse adult sex by default. The simple-words rule does not apply to that talk. Fiction between adults is fine, including dark or non-consent scenes. Do not give real-world how-to for illegal non-consensual harm.`;

  const affectAndDecay = `Memories are stored as durable facts (${FACT_KEY_LIST}) tagged with emotional intensity; high-affect facts carry greater weight in recall. Decay the affect tag over time rather than letting it compound — intensity should fade unless actively reinforced. When something gets recalled, show the user the tag and the decay state, not just the fact.

You may and should update durable facts and affect when the user states or corrects them. Call upsert_fact (one key per call) for ${FACT_KEY_LIST}. Call set_affect to change intensity 1–10 on any of those keys, including name. Do not invent facts. Do not call a tool unless the user stated or corrected the information. sexual_preference and porn are adults-only first-person facts — never write them if anyone mentioned is under 21, and never about someone else.

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

${affectAndDecay}

VISION

When a camera, shared-screen, or watch-together frame is attached, you can see it. Several stills may arrive in one message — recent moments from the video, and camera or screen if those are on. Comment on what is visible only when it is relevant to what the user is saying or asking. Do not narrate every live frame. If no frame is attached, you cannot see the screen, camera, or video.

When the user uploads a photo, look at it and analyze or describe what you see — do not ignore it. When they upload a video, you receive several stills sampled across the clip; look at those frames and analyze or discuss the video. Adults-only sexual content of the user is OK. If anyone in an uploaded photo or video appears under 21, refuse and stop. Soundtrack from an uploaded video is not the user — do not treat it as Ian speaking.

When they attach a file, you receive its text or a short note with the file name, type, and size. Talk about those attachments when they are present.

VOICE

Only the live microphone is the user (Ian). Television, shared-tab or watch-together soundtrack, speakers, and other people in the room are not him. Do not treat those voices as a user turn. Do not answer them, continue their lines, or echo TV or video dialogue. If a transcript is clearly media or someone else, ignore it and wait for Ian on the mic.

WATCH TOGETHER

The user can play a video in this tab or in a same-origin watch tab while they talk to you. When frames arrive from that video, you are watching it. Keep the conversation going while it plays. Never ask them to pause so you can listen, and never treat talking as a reason to stop the video. You do not hear the video soundtrack — it plays for them in the watch tab. On-screen voices are not the user. You can see what is on screen from the stills you receive, or by calling get_video_context. Call that tool when they ask what is happening, who or what is on screen, or anything that needs the current picture. Do not call it on every turn. If no video is loaded, say you cannot see a video.

TOYS

Adults only. Never send toy commands if anyone is under 21, or if anyone mentioned is a minor. Lovense is ${toys.lovense ? "configured" : "not configured"}. Joyhub is ${toys.joyhub ? "configured" : "not configured"}. Control this session: ${toys.granted ? "granted — you have full documented control" : "not granted"}.

You may control the user's adult toys only after they request it in their own words — take control, you can control the toys, Lexi take over the toys. Their ask grants control. Calling request_toy_control does not grant it; if you call that tool without a matching user grant it will be refused, and you must wait until they ask. Do not call toy_command, lovense_function, lovense_vibrate, lovense_stop, lovense_pattern, joyhub_vibrate, joyhub_stop, or joyhub_pattern until control is granted — except stop, which you must send immediately if they say stop.

When control is granted, you have the full documented Lovense Standard API set: Function (Vibrate, Rotate, Pump, Thrusting, Fingering, Suction, Depth, Stroke, Oscillate, All, Stop, and comma-separated combos), Preset (pulse, wave, fireworks, earthquake), Pattern (apiVer 2), Position, plus timeSec, loopRunningSec, loopPauseSec, and stopPrevious. Joyhub accepts the same command body when configured. Prefer the configured provider (lovense, joyhub, or all). If they revoke, control ends and toys stop. Never claim a toy moved if the API failed, the provider is not configured, or control was not granted.`;
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

async function fetchToyProviders() {
  try {
    const response = await fetch("/api/toys", {
      headers: { "ngrok-skip-browser-warning": "1" },
    });
    const body = (await response.json()) as {
      providers?: { lovense?: boolean; joyhub?: boolean };
    };
    return {
      lovense: Boolean(body.providers?.lovense),
      joyhub: Boolean(body.providers?.joyhub),
    };
  } catch {
    return { lovense: false, joyhub: false };
  }
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
        enum: [...FACT_KEYS],
        description: `Which durable fact to write: ${FACT_KEY_LIST}.`,
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

const GET_VIDEO_CONTEXT_TOOL = {
  type: "function",
  name: "get_video_context",
  description:
    "Look at the video the user is watching with you right now. Call this when they ask what is happening, what is on screen, or any question that needs the current picture. Returns a short scene description from several recent stills. Do not call this if no video is loaded.",
  parameters: {
    type: "object",
    properties: {
      question: {
        type: "string",
        description:
          "What to look for on screen. Default: describe what is happening now.",
      },
    },
  },
};

const REQUEST_TOY_CONTROL_TOOL = {
  type: "function",
  name: "request_toy_control",
  description:
    "Ask to confirm toy control. This never grants control by itself. Control flips only when the user asks in their own words. Call granted true after they ask; it is refused if they have not. Call granted false only after they revoke.",
  parameters: {
    type: "object",
    properties: {
      granted: {
        type: "boolean",
        description: "True only after the user requested control. False only after they revoked it.",
      },
    },
    required: ["granted"],
  },
};

const TOY_COMMAND_TOOL = {
  type: "function",
  name: "toy_command",
  description:
    "Send a consensual command to Lovense and/or Joyhub. Only after the user grants control, except stop when the user says stop. Tokens stay on the server.",
  parameters: {
    type: "object",
    properties: {
      provider: {
        type: "string",
        enum: ["lovense", "joyhub", "all"],
        description: "Which connected provider to use. Default: all configured providers.",
      },
      action: {
        type: "string",
        enum: [
          "vibrate",
          "rotate",
          "pump",
          "thrusting",
          "fingering",
          "suction",
          "depth",
          "stroke",
          "oscillate",
          "all",
          "stop",
          "pattern",
          "pulse",
          "preset",
          "function",
          "position",
        ],
        description: "Documented Lovense Standard API command. stop ends output immediately.",
      },
      strength: {
        type: "number",
        description: "Function level. Vibrate/Rotate/Thrusting/Fingering/Suction/Oscillate/All 0–20; Pump/Depth 0–3; Stroke 0–100.",
      },
      intensity: {
        type: "number",
        description: "Joyhub intensity 0–100. Optional if strength is set.",
      },
      durationSec: {
        type: "number",
        description: "Seconds to run. 0 means until stop. Default 8.",
      },
      pattern: {
        type: "string",
        description:
          "Lovense preset pulse/wave/fireworks/earthquake, a strength list like 20;10;5, or a Joyhub pattern name.",
      },
      functions: {
        type: "string",
        description: "Lovense Function string, including combos, e.g. Vibrate:10,Rotate:5 or Stroke:0-20,Thrusting:10.",
      },
      rule: {
        type: "string",
        description: "Lovense Pattern rule such as V:1;F:v;S:1000#. apiVer 2.",
      },
      loopRunningSec: {
        type: "number",
        description: "Lovense loop on-time. Must be greater than 1.",
      },
      loopPauseSec: {
        type: "number",
        description: "Lovense loop pause. Must be greater than 1.",
      },
      stopPrevious: {
        type: "number",
        description: "1 (default) stops the previous command; 0 stacks with it.",
      },
      toy: {
        type: "string",
        description: "Optional Lovense toy id. Omit to target all connected toys.",
      },
      position: {
        type: "number",
        description: "Solace Pro Position 0–100.",
      },
    },
    required: ["action"],
  },
};

const LOVENSE_VIBRATE_TOOL = {
  type: "function",
  name: "lovense_vibrate",
  description: "Vibrate Lovense toys. Only after the user grants toy control.",
  parameters: {
    type: "object",
    properties: {
      strength: { type: "number", description: "0–20. Default 10." },
      durationSec: { type: "number", description: "Seconds to run. 0 means until stop. Default 8." },
    },
  },
};

const LOVENSE_STOP_TOOL = {
  type: "function",
  name: "lovense_stop",
  description: "Stop Lovense toys immediately. Call this when the user says stop.",
  parameters: { type: "object", properties: {} },
};

const LOVENSE_PATTERN_TOOL = {
  type: "function",
  name: "lovense_pattern",
  description: "Play a Lovense preset or strength pattern. Only after toy control is granted.",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "pulse, wave, fireworks, earthquake, or a strength list like 20;10;5.",
      },
      durationSec: { type: "number", description: "Seconds to run. Default 8." },
    },
  },
};

const LOVENSE_FUNCTION_TOOL = {
  type: "function",
  name: "lovense_function",
  description:
    "Send a Lovense Function command — Vibrate, Rotate, Pump, Thrusting, Fingering, Suction, Depth, Stroke, Oscillate, All, or combos. Only after the user grants toy control.",
  parameters: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "Single function like Vibrate:12 or combo Vibrate:10,Rotate:5.",
      },
      strength: { type: "number", description: "Used when action is a bare function name." },
      durationSec: { type: "number", description: "Seconds to run. 0 means until stop. Default 8." },
      loopRunningSec: { type: "number", description: "Loop on-time greater than 1." },
      loopPauseSec: { type: "number", description: "Loop pause greater than 1." },
      stopPrevious: { type: "number", description: "1 stops the previous command; 0 stacks." },
      toy: { type: "string", description: "Optional toy id." },
    },
  },
};

const JOYHUB_VIBRATE_TOOL = {
  type: "function",
  name: "joyhub_vibrate",
  description: "Vibrate a Joyhub toy through the official partner API. Only after toy control is granted.",
  parameters: {
    type: "object",
    properties: {
      strength: { type: "number", description: "0–20, mapped to Joyhub intensity." },
      intensity: { type: "number", description: "0–100 if the official API uses that scale." },
      durationSec: { type: "number", description: "Seconds to run. Default 8." },
    },
  },
};

const JOYHUB_STOP_TOOL = {
  type: "function",
  name: "joyhub_stop",
  description: "Stop Joyhub toys immediately. Call this when the user says stop.",
  parameters: { type: "object", properties: {} },
};

const JOYHUB_PATTERN_TOOL = {
  type: "function",
  name: "joyhub_pattern",
  description: "Play a Joyhub pulse or named pattern through the official partner API. Only after control is granted.",
  parameters: {
    type: "object",
    properties: {
      name: { type: "string", description: "pulse or a partner-documented pattern name." },
      intensity: { type: "number", description: "0–100." },
      durationSec: { type: "number", description: "Seconds to run. Default 8." },
    },
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
        enum: [...FACT_KEYS],
        description: `Which fact’s affect tag to change: ${FACT_KEY_LIST}.`,
      },
      affect: {
        type: "number",
        description: "New intensity from 1 (low) to 10 (high).",
      },
    },
    required: ["memory_key", "affect"],
  },
};

function buildSessionUpdate(
  memoryInstructions = "",
  priorChat = "",
  sessionId = "",
  toys: ToysSessionState = DEFAULT_TOYS_STATE,
) {
  return {
    type: "session.update",
    session: {
      voice: "aria",
      instructions: buildInstructions(memoryInstructions, priorChat, sessionId, toys),
      reasoning: { effort: "none" },
      turn_detection: buildTurnDetection(),
      // web_search is server-side; client tools include memory, video context, and toys.
      tools: [
        { type: "web_search" },
        UPSERT_FACT_TOOL,
        SET_AFFECT_TOOL,
        GET_VIDEO_CONTEXT_TOOL,
        REQUEST_TOY_CONTROL_TOOL,
        TOY_COMMAND_TOOL,
        LOVENSE_VIBRATE_TOOL,
        LOVENSE_STOP_TOOL,
        LOVENSE_PATTERN_TOOL,
        LOVENSE_FUNCTION_TOOL,
        JOYHUB_VIBRATE_TOOL,
        JOYHUB_STOP_TOOL,
        JOYHUB_PATTERN_TOOL,
      ],
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
  private inWindow = { started: 0, chunks: 0, bytes: 0, rmsSum: 0, rmsMax: 0, gated: 0 };
  private micNoiseFloor = 0.02;
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
  private pendingVisionNotices: Array<{ source: VisionSource; active: boolean }> = [];
  private pendingVideoNotices: Array<{
    active: boolean;
    title?: string;
    source?: VideoSourceKind | null;
    remoteTab?: boolean;
  }> = [];
  private pendingAttachments: ReadyAttachment[] = [];
  private deferredLiveFrames: VisionFramePart[] = [];
  private lastDecayState = "";
  private videoContextProvider: VideoContextProvider | null = null;
  private captionPacer: CaptionPacer;
  private toyControlGranted = false;
  private lastUserUtterance = "";
  private toyProviders: { lovense: boolean; joyhub: boolean } = { lovense: false, joyhub: false };
  private toyGrantChanged = false;
  private keepAliveStop: (() => void) | null = null;
  private destKeepAliveStop: (() => void) | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnecting = false;
  private reconnectAttempts = 0;
  private everOpen = false;
  private wsGeneration = 0;
  private lastAudioSendT = 0;
  private openedAt = 0;
  private activeResponseId: string | null = null;
  private responseCreateInFlight = false;

  constructor(private handlers: SessionHandlers) {
    this.logger = createVoiceLogger(this.id);
    this.captionPacer = new CaptionPacer(
      (text) => this.handlers.onCaption?.(text),
      () => this.player?.queuedMs ?? 0,
    );
  }

  async start() {
    this.setPhase("connecting");
    this.logger.log("start", { url: REALTIME_URL, target_rate: TARGET_RATE });

    const ctx = createAudioContext();
    this.ctx = ctx;
    await resumeAudioContext(ctx);
    ctx.addEventListener("statechange", () => {
      void resumeAudioContext(ctx);
    });
    this.destKeepAliveStop = startDestinationKeepAlive(ctx, isIOSWebKit());

    const toysPromise = fetchToyProviders();
    let token: string;
    try {
      token = await this.fetchSessionToken(false);
    } catch (error) {
      this.fail(error);
      return;
    }

    const micStarted = Date.now();
    try {
      this.stream = await openUserMic();
      this.bindMic(this.stream);
      const track = this.stream.getAudioTracks()[0];
      const settings = track?.getSettings() ?? {};
      this.logger.log("mic.ok", {
        ms: Date.now() - micStarted,
        label: track?.label ?? "",
        content_hint: track && "contentHint" in track ? track.contentHint : undefined,
        settings,
      });
    } catch (error) {
      this.logger.error("mic", error, { ms: Date.now() - micStarted });
      this.fail(error);
      return;
    }

    await addCaptureWorklet(ctx);
    this.player = new PcmPlayer(ctx, TARGET_RATE);
    // User mic only. Watch-together and display/tab audio play locally and are never mixed here.
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
      capture_frames: captureFramesForRate(ctx.sampleRate),
      target_rate: TARGET_RATE,
    });

    this.keepAliveStop = installVoiceKeepAlive({
      resumeAudio: () => resumeAudioContext(this.ctx),
      ensureMic: () => this.ensureMic(),
      ping: () => this.heartbeat(),
      reclaim: () => this.reclaim(),
      onUnload: () => this.stop("client"),
    });

    this.toyProviders = await toysPromise;
    this.openWebSocket(token, false);
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

  async reclaim() {
    if (this.stopped) return;
    applyPlayAndRecordSession();
    claimMediaSession();
    await resumeAudioContext(this.ctx);
    this.restartDestKeepAlive();
    const track = this.stream?.getAudioTracks()[0];
    await this.ensureMic({ force: !micTrackUsable(track) });
    this.rebindCapture();
    this.heartbeat();
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      void this.reconnectSocket();
    }
  }

  setUserToyControl(granted: boolean) {
    this.lastUserUtterance = granted ? "Give Lexi toy control" : "Revoke toy control";
    this.applyUserToyControl(granted);
  }

  sendVisionFrame(source: VisionSource, dataUrl: string, timeSec?: number) {
    this.sendVisionFrames([{ source, dataUrl, timeSec }]);
  }

  sendVisionFrames(parts: VisionFramePart[], options?: SendVisionFramesOptions) {
    if (this.stopped || !this.ws || this.ws.readyState !== WebSocket.OPEN || !parts.length) return;
    if (shouldDeferLiveVision(this.phase, Boolean(options?.respond), parts.map((part) => part.source))) {
      this.deferredLiveFrames = parts;
      return;
    }
    const content: Array<Record<string, unknown>> = [];
    const labels: string[] = [];
    let bytes = 0;
    const watchTotal = parts.filter((part) => part.source === "watch").length;
    const uploadTotal = parts.filter((part) => part.source === "upload").length;
    let watchIndex = 0;
    let uploadIndex = 0;
    for (const part of parts) {
      const payload = part.dataUrl.includes(",")
        ? part.dataUrl.slice(part.dataUrl.indexOf(",") + 1)
        : part.dataUrl;
      bytes += Math.round((payload.length * 3) / 4);
      content.push({ type: "input_image", image_url: part.dataUrl });
      const time =
        typeof part.timeSec === "number" && Number.isFinite(part.timeSec)
          ? ` at ${formatTimecode(part.timeSec)}`
          : "";
      if (part.source === "watch") {
        watchIndex += 1;
        labels.push(`Watch-together frame ${watchIndex} of ${watchTotal}${time} (video, not the user).`);
      } else if (part.source === "upload") {
        uploadIndex += 1;
        labels.push(`Uploaded video frame ${uploadIndex} of ${uploadTotal}${time}.`);
      } else if (part.source === "camera") {
        labels.push("Camera viewfinder frame (user allowed).");
      } else {
        labels.push("Shared screen frame (user allowed).");
      }
    }
    this.logger.log("vision.frame", {
      source: parts.map((part) => part.source).join("+"),
      images: parts.length,
      bytes,
      respond: Boolean(options?.respond),
    });
    const preface = options?.prompt?.trim()
      ? `${options.prompt.trim()} `
      : watchTotal
        ? "The user is watching a video with you. These are separate recent stills from that video. Talk while it plays. On-screen voices are not Ian. Soundtrack may be absent — it plays in the watch tab. "
        : uploadTotal
          ? "USER UPLOADED VIDEO, analyze these frames. "
          : "";
    content.push({
      type: "input_text",
      text: `${preface}${labels.join(" ")}`,
    });
    this.send(
      {
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content,
        },
      },
      true,
    );
    if (options?.respond) this.requestSpokenResponse();
  }

  setVideoContextProvider(provider: VideoContextProvider | null) {
    this.videoContextProvider = provider;
  }

  notifyVideo(
    active: boolean,
    meta?: { title?: string; source?: VideoSourceKind | null; remoteTab?: boolean },
  ) {
    if (this.stopped) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.pendingVideoNotices.push({
        active,
        title: meta?.title,
        source: meta?.source,
        remoteTab: meta?.remoteTab,
      });
      return;
    }
    this.emitVideoNotice(active, meta);
  }

  notifyVision(source: VisionSource, active: boolean) {
    if (this.stopped) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.pendingVisionNotices.push({ source, active });
      return;
    }
    this.emitVisionNotice(source, active);
  }

  sendAttachments(items: ReadyAttachment[], respond = true) {
    if (this.stopped || !items.length) return;
    for (const item of items) {
      this.upsert({
        id: crypto.randomUUID(),
        role: "user",
        text:
          item.kind === "image"
            ? `Attached photo: ${item.name}`
            : item.kind === "video"
              ? `Attached video: ${item.name}`
              : item.text.split("\n")[0] || `Attached file: ${item.name}`,
      });
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        this.pendingAttachments.push(item);
        continue;
      }
      this.emitAttachment(item);
    }
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !respond) return;
    this.requestSpokenResponse();
  }

  private flushPendingVision() {
    const queued = this.pendingVisionNotices.splice(0);
    for (const item of queued) this.emitVisionNotice(item.source, item.active);
  }

  private flushDeferredLiveFrames() {
    const parts = this.deferredLiveFrames;
    if (!parts.length) return;
    this.deferredLiveFrames = [];
    this.sendVisionFrames(parts);
  }

  private flushPendingVideo() {
    const queued = this.pendingVideoNotices.splice(0);
    for (const item of queued) this.emitVideoNotice(item.active, item);
  }

  private emitVideoNotice(
    active: boolean,
    meta?: { title?: string; source?: VideoSourceKind | null; remoteTab?: boolean },
  ) {
    if (this.stopped || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const title = meta?.title?.trim();
    const text = active
      ? meta?.remoteTab
        ? `The user started a watch-together video${title ? ` (${title})` : ""} in another tab. You will see several stills at once from that video (and camera or screen if those are on). It keeps playing while you talk. You cannot hear the soundtrack — it plays in the watch tab. On-screen voices are not the user. Call get_video_context when you need to see what is on screen.`
        : `The user started a watch-together video${title ? ` (${title})` : ""}. Frames may arrive as several stills at once. It keeps playing while you talk. You cannot hear the soundtrack, and on-screen voices are not the user. Call get_video_context when you need to see what is on screen.`
      : "The user closed the watch-together video. You can no longer see frames from it.";
    this.logger.log("video.state", { active, title: title || undefined, source: meta?.source ?? undefined });
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

  private emitVisionNotice(source: VisionSource, active: boolean) {
    if (this.stopped || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const text = active
      ? source === "camera"
        ? "The user allowed camera viewfinder frames. You can see what the camera shows when a frame is attached. Comment only when relevant."
        : "The user started sharing their screen. You can see the shared screen when a frame is attached. Voices or audio from the shared screen, TV, or other media are not the user. Comment only when relevant."
      : source === "camera"
        ? "The user stopped the camera. You can no longer see the viewfinder."
        : "The user stopped screen sharing. You can no longer see the screen.";
    this.logger.log("vision.state", { source, active });
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

  stop(by: "client" | "error" = "client") {
    if (this.stopped) return;
    this.stopped = true;
    this.pendingVisionNotices = [];
    this.pendingVideoNotices = [];
    this.pendingAttachments = [];
    this.deferredLiveFrames = [];
    this.videoContextProvider = null;
    this.by = by;
    this.logger.log("stop", { by, phase: this.phase });
    this.clearReconnect();
    this.keepAliveStop?.();
    this.keepAliveStop = null;
    this.destKeepAliveStop?.();
    this.destKeepAliveStop = null;
    this.captionPacer.stop();
    this.activeResponseId = null;
    this.responseCreateInFlight = false;
    this.flushInWindow(true);
    this.player?.stop();
    this.worklet?.port.close();
    this.worklet?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.wsGeneration += 1;
    try {
      this.ws?.close();
    } catch {
      // ignore
    }
    void this.ctx?.close();
    this.logger.close();
    this.setPhase("idle");
  }

  private async fetchSessionToken(resume: boolean) {
    const tokenStarted = Date.now();
    const userId = clientUserId();
    if (!resume) {
      const previousSessionId = readVoiceSessionStore().sessionId;
      this.setMemorySessionId(newMemorySessionId(), userId);
      const response = await this.postRealtimeSession({
        sessionId: this.memorySessionId,
        logSessionId: this.id,
        userId,
        previousSessionId,
      });
      const body = await this.readSessionBody(response);
      if (!response.ok || !body.token) {
        this.logger.error("token", new Error(body.error || "token"), { ms: Date.now() - tokenStarted });
        throw new Error(body.error || "Could not start a voice session.");
      }
      this.memoryInstructions =
        typeof body.memoryInstructions === "string" ? body.memoryInstructions : "";
      if (typeof body.decayState === "string" && body.decayState.trim()) {
        this.lastDecayState = body.decayState;
      }
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
      return body.token;
    }

    const response = await this.postRealtimeSession({
      sessionId: this.memorySessionId,
      logSessionId: this.id,
      userId,
    });
    const body = await this.readSessionBody(response);
    if (!response.ok || !body.token) {
      this.logger.error("token.resume", new Error(body.error || "token"), {
        ms: Date.now() - tokenStarted,
      });
      throw new Error(body.error || "Could not resume the voice session.");
    }
    if (typeof body.memoryInstructions === "string") {
      this.memoryInstructions = body.memoryInstructions;
    }
    if (typeof body.priorChat === "string") this.priorChat = body.priorChat;
    if (body.priorTurns !== undefined) this.priorTurns = parseChatTurns(body.priorTurns);
    this.setMemorySessionId(body.sessionId ?? this.memorySessionId, userId);
    this.logger.log("token.resume", {
      ms: Date.now() - tokenStarted,
      memory_session: this.memorySessionId ?? undefined,
    });
    return body.token;
  }

  private postRealtimeSession(payload: Record<string, unknown>) {
    return fetch("/api/realtime/session", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-lexi-user-id": clientUserId(),
        "ngrok-skip-browser-warning": "1",
      },
      body: JSON.stringify(payload),
    });
  }

  private async readSessionBody(response: Response) {
    return (await response.json()) as {
      token?: string;
      error?: string;
      decayState?: string;
      memoryInstructions?: string;
      priorChat?: string;
      priorTurns?: unknown;
      sessionId?: string | null;
    };
  }

  private openWebSocket(token: string, resume: boolean) {
    const generation = ++this.wsGeneration;
    const previous = this.ws;
    this.ws = null;
    if (previous) {
      try {
        previous.close();
      } catch {
        // ignore
      }
    }

    this.logger.log("ws.connecting", { resume });
    const opened = Date.now();
    const ws = new WebSocket(REALTIME_URL, [`xai-client-secret.${token}`]);
    this.ws = ws;
    ws.binaryType = "arraybuffer";

    ws.addEventListener("open", () => {
      if (generation !== this.wsGeneration) return;
      this.everOpen = true;
      this.reconnecting = false;
      this.openedAt = Date.now();
      this.logger.log("ws.open", { ms: Date.now() - opened, resume });
      this.send(this.sessionUpdate());
      if (resume) this.injectLiveRows();
      else this.injectPriorChat();
      this.flushPendingVision();
      this.flushPendingVideo();
      void this.refreshDecayState();
      if (this.pending.length) {
        this.logger.log("audio.flush", { chunks: this.pending.length });
        for (const audio of this.pending) {
          this.send({ type: "input_audio_buffer.append", audio }, true);
        }
        this.pending = [];
      }
      if (!this.flushPendingText()) this.setPhase("listening");
    });

    ws.addEventListener("message", (event) => {
      if (generation !== this.wsGeneration) return;
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
      if (generation !== this.wsGeneration) return;
      this.logger.log("ws.error", { resume });
    });

    ws.addEventListener("close", (event) => {
      if (generation !== this.wsGeneration) return;
      this.logger.log("ws.close", {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
        by: this.by,
        resume,
      });
      if (this.stopped) return;
      if (this.openedAt && Date.now() - this.openedAt >= 10_000) {
        this.reconnectAttempts = 0;
      }
      if (this.everOpen || this.reconnectAttempts > 0) {
        this.reconnecting = false;
        void this.reconnectSocket();
        return;
      }
      this.fail(new Error(`Voice closed (${event.code}).`));
    });
  }

  private async reconnectSocket() {
    if (this.stopped || this.reconnecting) return;
    this.reconnecting = true;
    this.reconnectAttempts += 1;
    if (this.reconnectAttempts > 6) {
      this.reconnecting = false;
      this.fail(new Error("Voice connection dropped."));
      return;
    }
    this.logger.log("ws.reconnect", { attempt: this.reconnectAttempts });
    this.setPhase("connecting");
    const delay = this.reconnectAttempts === 1 ? 0 : Math.min(12_000, 800 * 2 ** (this.reconnectAttempts - 2));
    if (delay) {
      await new Promise<void>((resolve) => {
        this.reconnectTimer = setTimeout(resolve, delay);
      });
      this.reconnectTimer = null;
    }
    if (this.stopped) return;
    try {
      await resumeAudioContext(this.ctx);
      await this.ensureMic();
      const token = await this.fetchSessionToken(true);
      if (this.stopped) return;
      this.openWebSocket(token, true);
    } catch (error) {
      this.logger.error("ws.reconnect", error, { attempt: this.reconnectAttempts });
      this.reconnecting = false;
      void this.reconnectSocket();
    }
  }

  private clearReconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.reconnecting = false;
  }

  private restartDestKeepAlive() {
    if (this.stopped || !this.ctx || (this.ctx.state as string) === "closed") return;
    this.destKeepAliveStop?.();
    this.destKeepAliveStop = startDestinationKeepAlive(this.ctx, isIOSWebKit());
  }

  private rebindCapture() {
    if (this.stopped || !this.ctx || !this.stream || !this.worklet) return;
    try {
      this.source?.disconnect();
    } catch {
      // already disconnected
    }
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.source.connect(this.worklet);
  }

  private bindMic(stream: MediaStream) {
    const track = stream.getAudioTracks()[0];
    if (!track) return;
    applyMicTrackHints(track);
    track.onended = () => {
      this.logger.log("mic.ended", {});
      if (!isAudioSessionInterrupted()) void this.ensureMic({ force: true });
    };
    track.onmute = () => {
      this.logger.log("mic.mute", {});
      window.setTimeout(() => {
        if (this.stopped || isAudioSessionInterrupted()) return;
        void this.ensureMic({ force: isIOSWebKit() || !micTrackUsable(track) });
      }, 400);
    };
    track.onunmute = () => {
      void applyMicConstraints(track);
      this.handlers.onMicRecovered?.();
    };
  }

  private async ensureMic(opts: { force?: boolean } = {}) {
    if (this.stopped || !this.ctx) return;
    if (isAudioSessionInterrupted()) return;
    const track = this.stream?.getAudioTracks()[0];
    if (!opts.force && micTrackUsable(track)) {
      await applyMicConstraints(track);
      this.handlers.onMicRecovered?.();
      return;
    }
    try {
      const next = await openUserMic();
      this.source?.disconnect();
      this.stream?.getTracks().forEach((item) => item.stop());
      this.stream = next;
      this.bindMic(next);
      if (this.worklet) {
        this.source = this.ctx.createMediaStreamSource(next);
        this.source.connect(this.worklet);
      }
      this.logger.log("mic.reacquire", {
        label: next.getAudioTracks()[0]?.label ?? "",
        state: next.getAudioTracks()[0]?.readyState,
      });
      this.handlers.onMicRecovered?.();
    } catch (error) {
      this.logger.error("mic.reacquire", error);
      const name = error instanceof Error ? error.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        this.handlers.onMicNeedsGesture?.();
      }
    }
  }

  private heartbeat() {
    if (this.stopped) return;
    void resumeAudioContext(this.ctx);
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (Date.now() - this.lastAudioSendT < 3000) return;
    const silence = pcm16ToBase64(new Uint8Array(Math.round((TARGET_RATE * KEEPALIVE_SILENCE_MS) / 1000) * 2));
    this.send({ type: "input_audio_buffer.append", audio: silence }, true);
    this.lastAudioSendT = Date.now();
  }

  private injectLiveRows() {
    let items = 0;
    for (const row of this.rows.slice(-20)) {
      const text = row.text.trim();
      if (!text) continue;
      this.send(
        {
          type: "conversation.item.create",
          item: {
            type: "message",
            role: row.role,
            content: [{ type: row.role === "assistant" ? "text" : "input_text", text }],
          },
        },
        true,
      );
      items += 1;
    }
    this.logger.log("ws.replay", { items });
  }

  private onMic(frame: Float32Array) {
    if (this.stopped || !this.ctx) return;
    const micRate = this.stream?.getAudioTracks()[0]?.getSettings().sampleRate ?? this.ctx.sampleRate;
    const resampled = resample(frame, micRate, TARGET_RATE);
    const pcm = floatToPcm16(resampled);
    this.micNoiseFloor = updateMicNoiseFloor(this.micNoiseFloor, pcm.rms);
    const primary = isPrimaryMicEnergy(pcm.rms, this.micNoiseFloor);
    // Low / non-primary energy is sent as silence so server VAD does not treat TV bleed as speech.
    const audio = pcm16ToBase64(primary ? pcm.bytes : new Uint8Array(pcm.bytes.length));
    this.noteIn(pcm.bytes.length, pcm.rms, !primary);

    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      if (this.pending.length < PREOPEN_CAP) this.pending.push(audio);
      return;
    }
    this.send({ type: "input_audio_buffer.append", audio }, true);
    this.lastAudioSendT = Date.now();
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
        this.responseCreateInFlight = false;
        this.activeResponseId = null;
        const dropped = this.player?.flush() ?? 0;
        this.send({ type: "response.cancel" });
        this.logger.log("play.stop", { reason: "barge-in", dropped_ms: dropped });
        this.captionPacer.stop();
        // Barge-in cancels Lexi's speech only. Never pause or stop a watch-together video.
        this.setPhase("listening");
        break;
      }
      case "input_audio_buffer.speech_stopped":
        this.speechStoppedT = Date.now();
        this.setPhase("thinking");
        break;
      case "input_audio_buffer.committed": {
        const itemId = typeof event.item_id === "string" ? event.item_id : crypto.randomUUID();
        this.upsert({ id: itemId, role: "user", text: "" });
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
      case "response.created": {
        const incomingId = readResponseId(event);
        this.ignoreOutputAudio = false;
        this.responseCreateInFlight = false;
        const claim = claimExclusiveSpeech(this.activeResponseId, incomingId ?? PENDING_SPEECH_ID);
        if (claim.takeFloor) {
          const dropped = this.player?.flush() ?? 0;
          if (dropped) this.logger.log("play.stop", { reason: "exclusive", dropped_ms: dropped });
          this.captionPacer.reset();
        }
        this.activeResponseId = claim.activeId;
        this.createdT = Date.now();
        this.firstAudio = false;
        this.outDeltas = 0;
        this.outBytes = 0;
        this.toolsThisResponse = false;
        this.factWriteSucceeded = false;
        this.player?.resetTurn();
        this.captionPacer.reset();
        break;
      }
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
        if (transcript) {
          this.upsert({ id: responseId, role: "assistant", text: transcript });
          if (
            shouldPlayOutputAudio({
              ignore: this.ignoreOutputAudio,
              activeId: this.activeResponseId,
              incomingId: readResponseId(event),
            })
          ) {
            this.captionPacer.replaceFull(transcript);
          }
        }
        break;
      }
      case "response.done": {
        const response = (event.response ?? {}) as Record<string, unknown>;
        const responseId = readResponseId(event) ?? (typeof response.id === "string" ? response.id : "");
        if (
          this.activeResponseId === PENDING_SPEECH_ID ||
          (responseId && responseId === this.activeResponseId)
        ) {
          this.activeResponseId = null;
        }
        this.responseCreateInFlight = false;
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
        if (status !== "cancelled" && status !== "failed") {
          void this.refreshDecayState();
          this.captionPacer.flush();
        } else {
          this.captionPacer.stop();
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
    const incomingId = readResponseId(event);
    this.activeResponseId = lockSpeechId(this.activeResponseId, incomingId);
    if (
      !shouldPlayOutputAudio({
        ignore: this.ignoreOutputAudio,
        activeId: this.activeResponseId,
        incomingId,
      })
    ) {
      return;
    }
    const raw = typeof event.delta === "string" ? event.delta : typeof event.audio === "string" ? event.audio : "";
    if (!raw || !this.player) return;
    const bytes = base64ToBytes(raw);
    this.outDeltas += 1;
    this.outBytes += bytes.byteLength;
    this.player.play(bytes);
    if (!this.firstAudio) {
      this.firstAudio = true;
      this.captionPacer.markSpeechStart();
      const responseId = incomingId ?? "";
      this.logger.log("audio.out.first", {
        response_id: responseId,
        bytes: bytes.byteLength,
        since_response_created_ms: this.createdT ? Date.now() - this.createdT : 0,
        since_speech_stopped_ms: this.speechStoppedT ? Date.now() - this.speechStoppedT : 0,
        play_state: this.player.state,
      });
      this.setPhase("speaking");
    }
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
      if (name === "request_toy_control") {
        const requested = args.granted !== false && args.granted !== "false";
        const resolved = resolveToyControlRequest({
          requested,
          lastUserUtterance: this.lastUserUtterance,
          alreadyGranted: this.toyControlGranted,
        });
        if (!resolved.ok) {
          result = {
            ok: false,
            controlGranted: this.toyControlGranted,
            error: resolved.error,
          };
        } else {
          result = this.applyUserToyControl(resolved.granted);
        }
      } else if (
        name === "toy_command" ||
        name === "lovense_function" ||
        name === "lovense_vibrate" ||
        name === "lovense_stop" ||
        name === "lovense_pattern" ||
        name === "joyhub_vibrate" ||
        name === "joyhub_stop" ||
        name === "joyhub_pattern"
      ) {
        result = await this.runToyCommand(name, args);
      } else if (name === "get_video_context") {
        result = await this.runVideoContext(
          typeof args.question === "string" ? args.question : "",
        );
      } else if (name === "upsert_fact" || name === "set_affect") {
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
      result = { error: error instanceof Error ? error.message : "Tool call failed." };
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
    if (this.factWriteSucceeded || this.toyGrantChanged) {
      this.toyGrantChanged = false;
      this.send(this.sessionUpdate());
    }
    this.requestSpokenResponse();
  }

  private requestSpokenResponse() {
    if (this.stopped || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const decision = decideResponseCreate({
      createInFlight: this.responseCreateInFlight,
      hasActiveResponse: this.activeResponseId !== null,
    });
    if (decision === "skip") return;
    if (decision === "replace") {
      this.send({ type: "response.cancel" });
      this.ignoreOutputAudio = true;
      const dropped = this.player?.flush() ?? 0;
      this.logger.log("play.stop", { reason: "replace", dropped_ms: dropped });
      this.captionPacer.reset();
      this.activeResponseId = null;
    }
    this.responseCreateInFlight = true;
    this.send({ type: "response.create" });
    this.setPhase("thinking");
  }

  private sessionUpdate() {
    return buildSessionUpdate(
      this.memoryInstructions,
      this.priorChat,
      this.currentSessionId() ?? "",
      {
        lovense: this.toyProviders.lovense,
        joyhub: this.toyProviders.joyhub,
        granted: this.toyControlGranted,
      },
    );
  }

  private applyUserToyControl(granted: boolean) {
    if (this.toyControlGranted !== granted) {
      this.toyControlGranted = granted;
      this.toyGrantChanged = true;
      this.logger.log("toys.control", { granted, source: "user" });
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.send(this.sessionUpdate());
      }
      if (!granted) {
        void this.runToyCommand("toy_command", { action: "stop" });
      }
    }
    this.handlers.onToyControl?.(granted);
    return { ok: true, controlGranted: granted, source: "user" };
  }

  private noteUserToyIntent(text: string) {
    this.lastUserUtterance = text;
    const intent = parseToyControlIntent(text);
    if (intent === "grant") this.applyUserToyControl(true);
    if (intent === "revoke") this.applyUserToyControl(false);
  }

  private async runToyCommand(name: string, args: Record<string, unknown>) {
    const functions =
      typeof args.functions === "string"
        ? args.functions
        : name === "lovense_function" && typeof args.action === "string"
          ? args.action
          : undefined;
    const action =
      name.endsWith("_stop") || args.action === "stop"
        ? "stop"
        : name.endsWith("_function")
          ? "function"
          : name.endsWith("_pattern")
            ? args.action === "pulse"
              ? "pulse"
              : "pattern"
            : name.endsWith("_vibrate")
              ? "vibrate"
              : typeof args.action === "string"
                ? args.action
                : "";
    const provider = name.startsWith("lovense_")
      ? "lovense"
      : name.startsWith("joyhub_")
        ? "joyhub"
        : typeof args.provider === "string"
          ? args.provider
          : "all";

    if (action !== "stop" && !this.toyControlGranted) {
      return {
        error: "Toy control is not granted. The user must request it first.",
        controlGranted: false,
      };
    }

    const response = await fetch("/api/toys", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "1",
      },
      body: JSON.stringify({
        provider,
        action,
        strength: args.strength,
        intensity: args.intensity,
        durationSec: args.durationSec,
        pattern: args.pattern ?? args.name,
        functions,
        rule: args.rule,
        toy: args.toy,
        loopRunningSec: args.loopRunningSec,
        loopPauseSec: args.loopPauseSec,
        stopPrevious: args.stopPrevious,
        position: args.position,
        controlGranted: this.toyControlGranted,
      }),
    });
    let body: Record<string, unknown> = {};
    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch {
      body = { error: `Toy API returned ${response.status}.` };
    }
    if (!response.ok) {
      this.logger.log("toys.command.fail", { name, status: response.status, error: body.error });
      return {
        error: typeof body.error === "string" ? body.error : "Toy command failed.",
        moved: false,
      };
    }
    this.logger.log("toys.command.ok", { name, action, provider });
    return { ...body, moved: true };
  }

  private async runVideoContext(question: string): Promise<Record<string, unknown>> {
    if (!this.videoContextProvider) {
      return { error: "No video is loaded." };
    }
    const snapshot = await this.videoContextProvider();
    if (!snapshot.loaded) {
      return { error: "No video is loaded." };
    }
    if (snapshot.captureError && !snapshot.frames.length) {
      return {
        error: snapshot.captureError,
        title: snapshot.title,
        currentTime: snapshot.currentTime,
        duration: snapshot.duration,
        playing: snapshot.playing,
      };
    }

    this.logger.log("video.context", {
      title: snapshot.title,
      frames: snapshot.frames.length,
      current_time: snapshot.currentTime,
      playing: snapshot.playing,
    });

    const cacheKey = videoContextCacheKey({
      title: snapshot.title,
      question,
      currentTime: snapshot.currentTime,
      frames: snapshot.frames,
    });
    const cached = readVideoContextCache(cacheKey);
    if (cached) {
      this.logger.log("video.context.cache", { chars: cached.description.length });
      return {
        description: cached.description,
        title: snapshot.title,
        currentTime: snapshot.currentTime,
        currentTimeLabel: formatTimecode(snapshot.currentTime),
        duration: snapshot.duration,
        durationLabel: formatTimecode(snapshot.duration),
        playing: snapshot.playing,
        paused: snapshot.paused,
        source: snapshot.source,
        cached: true,
      };
    }

    const response = await fetch("/api/video/context", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "1",
      },
      body: JSON.stringify({
        frames: snapshot.frames,
        question,
        title: snapshot.title,
        currentTime: snapshot.currentTime,
        duration: snapshot.duration,
        playing: snapshot.playing,
        logSessionId: this.id,
      }),
    });
    let body: Record<string, unknown> = {};
    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch {
      body = { error: `Video context returned ${response.status}.` };
    }
    if (!response.ok) {
      this.logger.log("video.context.fail", {
        status: response.status,
        error: body.error,
      });
      return {
        error: typeof body.error === "string" ? body.error : "Could not analyze the video.",
        title: snapshot.title,
        currentTime: snapshot.currentTime,
        duration: snapshot.duration,
        playing: snapshot.playing,
      };
    }
    this.logger.log("video.context.ok", {
      model: body.model,
      chars: typeof body.description === "string" ? body.description.length : 0,
    });
    if (typeof body.description === "string" && body.description.trim()) {
      writeVideoContextCache(
        cacheKey,
        body.description,
        typeof body.model === "string" ? body.model : undefined,
      );
    }
    return {
      description: body.description,
      title: snapshot.title,
      currentTime: snapshot.currentTime,
      currentTimeLabel: formatTimecode(snapshot.currentTime),
      duration: snapshot.duration,
      durationLabel: formatTimecode(snapshot.duration),
      playing: snapshot.playing,
      paused: snapshot.paused,
      source: snapshot.source,
    };
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

  private sendDecayItem(state: string) {
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

  private sendCachedDecay() {
    if (this.decaySentForTurn || !this.lastDecayState) return;
    this.decaySentForTurn = true;
    this.sendDecayItem(this.lastDecayState);
  }

  private async refreshDecayState() {
    if (this.stopped || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.sendCachedDecay();
    const state = await fetchDecayStateForTurn();
    this.lastDecayState = state;
    if (this.stopped || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!this.decaySentForTurn) {
      this.decaySentForTurn = true;
      this.sendDecayItem(state);
    }
  }

  private emitText(text: string) {
    this.decaySentForTurn = false;
    this.sendCachedDecay();
    this.send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      },
    });
    this.requestSpokenResponse();
    void this.refreshDecayState();
  }

  private emitAttachment(item: ReadyAttachment) {
    if (this.stopped || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (item.kind === "image") {
      const payload = item.dataUrl.includes(",")
        ? item.dataUrl.slice(item.dataUrl.indexOf(",") + 1)
        : item.dataUrl;
      this.logger.log("attachment.image", {
        name: item.name,
        bytes: Math.round((payload.length * 3) / 4),
      });
      this.send(
        {
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "user",
            content: [
              { type: "input_image", image_url: item.dataUrl },
              {
                type: "input_text",
                text: `USER UPLOADED PHOTO ${item.name}. Look at this image and analyze or describe what you see.`,
              },
            ],
          },
        },
        true,
      );
      return;
    }
    if (item.kind === "video") {
      const soundtrack = item.hasAudio
        ? " This clip has a soundtrack; it is not Ian speaking."
        : " Do not treat any soundtrack as the user.";
      this.logger.log("attachment.video", {
        name: item.name,
        frames: item.frames.length,
        durationSec: item.durationSec,
        hasAudio: item.hasAudio,
        analysis: item.analysis,
      });
      const analysisPrompt =
        item.analysis === "first-look"
          ? `USER UPLOADED VIDEO ${item.name}, first look at these early sampled frames. Start analyzing now; more frames from the same clip will follow.${soundtrack}`
          : item.analysis === "refine"
            ? `More frames from uploaded video ${item.name} across the rest of the clip. Complete your analysis with these plus the earlier frames.${soundtrack}`
            : `USER UPLOADED VIDEO ${item.name}, analyze these frames.${soundtrack}`;
      this.sendVisionFrames(
        item.frames.map((frame) => ({
          source: "upload",
          dataUrl: frame.dataUrl,
          timeSec: frame.timeSec,
        })),
        {
          prompt: analysisPrompt,
        },
      );
      return;
    }
    this.logger.log("attachment.file", { name: item.name, chars: item.text.length });
    this.send({
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: item.text }],
      },
    });
  }

  private flushPendingText() {
    const queued = this.pendingText.splice(0);
    const attachments = this.pendingAttachments.splice(0);
    if (!queued.length && !attachments.length) return false;
    this.logger.log("text.flush", { messages: queued.length, attachments: attachments.length });
    this.decaySentForTurn = false;
    this.sendCachedDecay();
    for (const item of attachments) this.emitAttachment(item);
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
    this.requestSpokenResponse();
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

  private noteIn(bytes: number, rms: number, gated = false) {
    const now = Date.now();
    if (!this.inWindow.started) this.inWindow.started = now;
    this.inWindow.chunks += 1;
    this.inWindow.bytes += bytes;
    this.inWindow.rmsSum += rms;
    this.inWindow.rmsMax = Math.max(this.inWindow.rmsMax, rms);
    if (gated) this.inWindow.gated += 1;
    if (now - this.inWindow.started >= 2000) this.flushInWindow();
  }

  private flushInWindow(force = false) {
    if (!this.inWindow.started || (!force && this.inWindow.chunks === 0)) return;
    this.logger.log("audio.in", {
      chunks: this.inWindow.chunks,
      bytes: this.inWindow.bytes,
      rms_max: this.inWindow.rmsMax,
      rms_avg: this.inWindow.chunks ? this.inWindow.rmsSum / this.inWindow.chunks : 0,
      gated: this.inWindow.gated,
      noise_floor: this.micNoiseFloor,
      pending: this.pending.length,
      mic_state: this.stream?.getAudioTracks()[0]?.readyState,
      phase: this.phase,
    });
    this.inWindow = { started: 0, chunks: 0, bytes: 0, rmsSum: 0, rmsMax: 0, gated: 0 };
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
      const latest = [...this.rows].reverse().find((row) => row.text.trim());
      if (latest) this.handlers.onCaption?.(latest.text);
    }
  }

  private injectPriorChat() {
    if (!this.priorTurns.length) return;
    const pending = new Set(this.pendingText.map((text) => text.trim()).filter(Boolean));
    let items = 0;
    for (const turn of withoutLatestUserLine(this.priorTurns)) {
      const user = turn.user_text.trim();
      const assistant = turn.assistant_text.trim();
      if (user && !pending.has(user)) {
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
    const text = existing ? existing.text + delta : delta;
    this.upsert({
      id: responseId,
      role: "assistant",
      text,
    });
    if (
      shouldPlayOutputAudio({
        ignore: this.ignoreOutputAudio,
        activeId: this.activeResponseId,
        incomingId: readResponseId(event),
      })
    ) {
      this.captionPacer.append(text, readWordStartsMs(event));
    }
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
    if (row.role === "user" && row.text.trim()) {
      this.noteUserToyIntent(row.text);
      this.captionPacer.stop();
      this.handlers.onCaption?.(row.text);
    }
  }

  private setPhase(phase: VoicePhase) {
    if (this.phase === phase) return;
    this.phase = phase;
    this.logger.log("phase", { phase });
    this.handlers.onPhase(phase);
    if (phase === "speaking" || phase === "listening") this.flushDeferredLiveFrames();
  }

  private fail(error: unknown) {
    const message = error instanceof Error ? error.message : "Voice session failed.";
    this.handlers.onError(`${message} (voice session ${this.id})`);
    this.stop("error");
  }
}
