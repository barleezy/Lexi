import {
  TARGET_RATE,
  PcmPlayer,
  addCaptureWorklet,
  applyMicConstraints,
  applyMicTrackHints,
  base64ToBytes,
  createAudioContext,
  floatToPcm16,
  isCarLikeAudioInput,
  isPrimaryMicEnergy,
  micNeedsReroute,
  micTrackUsable,
  muteReclaimDelayMs,
  openUserMic,
  openUserMicWithRetry,
  pcm16ToBase64,
  resolvePreferredAudioInput,
  resample,
  resumeAudioContext,
  startDestinationKeepAlive,
  updateMicNoiseFloor,
} from "@/lib/voice/audio";
import {
  applyPlayAndRecordSession,
  claimMediaSession,
  installVoiceKeepAlive,
  isExclusiveMicError,
  isIOSWebKit,
  isCarAudioRoute,
  setCarAudioRoute,
  isMediaSessionYielded,
  isVoiceAudioInterrupted,
  KEEPALIVE_SILENCE_MS,
  shouldClaimMediaSession,
  setMediaSessionYield,
} from "@/lib/voice/keepalive";
import { scoreSalience } from "@/lib/memory/decay";
import { FACT_KEY_LIST, FACT_KEYS, isPinnedKey, PINNED_AFFECT } from "@/lib/memory/extract";
import { newMemorySessionId, parseSessionId } from "@/lib/memory/session-id";
import {
  turnsToTranscripts,
  type ChatTurn,
} from "@/lib/memory/turns";
import { isAdminUserId, ensureBrowserUserId } from "@/lib/memory/user";
import { createVoiceLogger, type VoiceLogger } from "@/lib/voice/logger";
import {
  clearCallContinuityStore,
  readVoiceSessionStore,
  writePreviousSessionId,
  writeVoiceSessionStore,
} from "@/lib/voice/persist";
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
import {
  mergeLiveVisionParts,
  type SendVisionFramesOptions,
  type VisionFramePart,
  type VisionSource,
} from "@/lib/voice/vision";
import { parseToyControlIntent, resolveToyControlRequest } from "@/lib/voice/toy-control";
import {
  PREOPEN_CAP,
  buildTurnDetection,
  captureFramesForRate,
  shouldDeferLiveVision,
} from "@/lib/voice/realtime-latency";
import { buildInputAudio, readUserTranscript, sanitizeUserText } from "@/lib/voice/listen";
import {
  EXPECT_STALL_MS,
  PENDING_SPEECH_ID,
  RESPONSE_CREATE_STALL_MS,
  TOOL_CALL_TIMEOUT_MS,
  claimExclusiveSpeech,
  decidePlaybackHandoff,
  decideResponseCreate,
  decideToolFollowUpCreate,
  responseCreateDelayMs,
  isIgnorableRealtimeError,
  isRecoverableRealtimeError,
  lockSpeechId,
  previousIdForHandoff,
  raceTimeout,
  readResponseId,
  shouldClearExpectAfterDone,
  shouldPlayOutputAudio,
  shouldReleaseSpeechFloor,
} from "@/lib/voice/exclusive-speech";
import type { GeneratedMediaItem } from "@/lib/generate/media";
import { readGeneratePrompt } from "@/lib/generate/safety";
import {
  CLOCK_REFRESH_MS,
  detectClientTimeZone,
  formatCurrentTimeLine,
  resolveVoiceTimeZone,
} from "@/lib/voice/clock";
import {
  formatDeviceLocationLine,
  type DeviceLocationState,
} from "@/lib/voice/location";
import {
  DEFAULT_CHANNEL_STATE,
  DEFAULT_FORTNITE_STATE,
  DEFAULT_MUSIC_STATE,
  DEFAULT_TOYS_STATE,
  buildInstructions,
  type ChannelSessionState,
  type FortniteSessionState,
  type MusicSessionState,
  type ToysSessionState,
} from "@/lib/voice/persona";
import { parseAudioSourceUrl } from "@/lib/voice/background-music";
import {
  looksLikePlaylistQuery,
  parseAppleMusicPlaylistId,
  parseAppleMusicPlaylistIdFromInput,
} from "@/lib/apple-music/config";
import { fortniteRealtimeTools, sanitizeFortniteToolResult } from "@/lib/voice/fortnite-tools";
import { REALTIME_VOICE_MODEL } from "@/lib/xai/realtime-model";

export type { GeneratedMediaItem };

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
  onConnectFail?: (message: string) => void;
  onSessionId?: (sessionId: string | null) => void;
  onToyControl?: (granted: boolean) => void;
  onToyControlRequest?: (pending: boolean) => void;
  onMicNeedsGesture?: () => void;
  onMicRecovered?: () => void;
  onWallet?: (info: { voiceSeconds: number; holdSeconds: number; capAtMs: number | null }) => void;
  onGeneratedMedia?: (item: GeneratedMediaItem) => void;
  onMusicState?: (state: MusicSessionState) => void;
  connectAppleMusic?: () => Promise<{ ok: boolean; connected?: boolean; error?: string }>;
  disconnectAppleMusic?: () => Promise<{ ok: boolean; error?: string }>;
  playBackgroundUrl?: (url: string, title?: string) => Promise<{ ok: boolean; title?: string; error?: string }>;
  playAppleMusicSong?: (
    songId: string,
    title?: string,
  ) => Promise<{ ok: boolean; title?: string; error?: string }>;
  playAppleMusicPlaylist?: (
    playlistId: string,
    title?: string,
  ) => Promise<{ ok: boolean; title?: string; error?: string }>;
  stopBackgroundMusic?: () => Promise<void>;
};

export type VideoContextProvider = () => Promise<VideoContextSnapshot>;

const REALTIME_URL = `wss://api.x.ai/v1/realtime?model=${REALTIME_VOICE_MODEL}&ngrok-skip-browser-warning=1`;

// Lexi (Beta): persona+rules live in lib/voice/persona.ts (shared with text channels).

function readFriendPresence(raw: unknown): FortniteSessionState["friendPresence"] {
  const row =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : null;
  const state = row && typeof row.state === "string" ? row.state : typeof raw === "string" ? raw : "";
  if (state === "online" || state === "offline") return state;
  return "unknown";
}

function clientUserId() {
  if (typeof document === "undefined") return "";
  return ensureBrowserUserId();
}

async function fetchFortniteStatus(): Promise<FortniteSessionState> {
  try {
    const response = await fetch("/api/fortnite", {
      headers: { "ngrok-skip-browser-warning": "1" },
    });
    const body = (await response.json()) as {
      configured?: boolean;
      epicHttpReady?: boolean;
      lexi?: { displayName?: string };
      friend?: { displayName?: string; relation?: string; presence?: unknown };
      friendDisplayName?: string;
      party?: {
        inParty?: boolean;
        inIanParty?: boolean;
        sittingOut?: boolean;
        withFriend?: boolean;
        visibleInFortnite?: boolean;
      };
    };
    const inIanParty =
      body.party?.withFriend === true ||
      body.party?.inIanParty === true ||
      body.party?.visibleInFortnite === true;
    return {
      configured: Boolean(body.configured),
      displayName: typeof body.lexi?.displayName === "string" ? body.lexi.displayName : "",
      friendDisplayName:
        typeof body.friend?.displayName === "string"
          ? body.friend.displayName
          : typeof body.friendDisplayName === "string"
            ? body.friendDisplayName
            : DEFAULT_FORTNITE_STATE.friendDisplayName,
      friendRelation: typeof body.friend?.relation === "string" ? body.friend.relation : "none",
      friendPresence: readFriendPresence(body.friend?.presence),
      epicHttpReady: body.epicHttpReady === true,
      inParty: inIanParty,
      sittingOut: body.party?.sittingOut === true && inIanParty,
    };
  } catch {
    return { ...DEFAULT_FORTNITE_STATE };
  }
}

async function fetchChannelStatus(): Promise<ChannelSessionState> {
  try {
    const response = await fetch("/api/channels", {
      headers: { "ngrok-skip-browser-warning": "1" },
    });
    const body = (await response.json()) as {
      platforms?: Partial<ChannelSessionState>;
    };
    return {
      discord: Boolean(body.platforms?.discord),
      telegram: Boolean(body.platforms?.telegram),
      sms: Boolean(body.platforms?.sms),
      email: Boolean(body.platforms?.email),
    };
  } catch {
    return { ...DEFAULT_CHANNEL_STATE };
  }
}

async function fetchAppleMusicStatus(): Promise<Pick<MusicSessionState, "appleConfigured" | "appleConnected">> {
  try {
    const response = await fetch("/api/apple-music", {
      headers: { "ngrok-skip-browser-warning": "1" },
    });
    const body = (await response.json()) as { configured?: boolean; connected?: boolean };
    return {
      appleConfigured: Boolean(body.configured),
      appleConnected: Boolean(body.connected),
    };
  } catch {
    return { appleConfigured: false, appleConnected: false };
  }
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
    "Create or update one durable fact the user stated or corrected. One memory_key per call. Do not invent facts. Omit affect to keep the current tag, or default name and our_song to 10. our_song stays at 10.",
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
        description: "Optional intensity 1–10. If omitted, name and our_song default to 10; other keys keep their current tag or start at 5. our_song cannot be lowered.",
      },
    },
    required: ["memory_key", "value"],
  },
};

const GET_VIDEO_CONTEXT_TOOL = {
  type: "function",
  name: "get_video_context",
  description:
    "Read the live camera and/or shared tab yourself. Never ask the user to describe what is on screen or on camera. Returns a description of each live stream. Call this when they ask what is on camera, on the tab, or on both.",
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

const GENERATE_IMAGE_TOOL = {
  type: "function",
  name: "generate_image",
  description:
    "Generate a photo with Grok Imagine when the user asks for a picture, or after they agree to one you offered. Pass their full request as prompt. Adults only — refuse anyone who looks under 18. Do not call this unsolicited.",
  parameters: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "The full image request. Do not shorten it.",
      },
      aspect_ratio: {
        type: "string",
        enum: [
          "1:1",
          "3:4",
          "4:3",
          "9:16",
          "16:9",
          "2:3",
          "3:2",
          "9:19.5",
          "19.5:9",
          "9:20",
          "20:9",
          "1:2",
          "2:1",
          "21:9",
          "5:2",
          "auto",
        ],
        description: "Optional frame. Omit unless he asked for a shape.",
      },
      resolution: {
        type: "string",
        enum: ["1k", "2k"],
        description: "Optional. Default 1k.",
      },
    },
    required: ["prompt"],
  },
};

const GENERATE_VIDEO_TOOL = {
  type: "function",
  name: "generate_video",
  description:
    "Generate a short video with Grok Imagine when the user asks for a clip, or after they agree. Pass their full request as prompt. Adults only — refuse anyone who looks under 18. Video can take a minute. Do not call this unsolicited.",
  parameters: {
    type: "object",
    properties: {
      prompt: {
        type: "string",
        description: "The full video request. Do not shorten it.",
      },
      duration: {
        type: "number",
        description: "Seconds, 1–15. Default 8.",
      },
      aspect_ratio: {
        type: "string",
        enum: ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"],
        description: "Optional frame. Omit unless he asked for a shape.",
      },
      resolution: {
        type: "string",
        enum: ["480p", "720p", "1080p"],
        description: "Optional. Default is the model default.",
      },
      silent: {
        type: "boolean",
        description: "True for a silent clip. Default has audio.",
      },
    },
    required: ["prompt"],
  },
};

const SEND_MESSAGE_TOOL = {
  type: "function",
  name: "send_message",
  description:
    "Message Ian on Discord, Telegram, SMS, or email. Only when he asked or you have a clear reason. Do not spam. Tokens stay on the server.",
  parameters: {
    type: "object",
    properties: {
      platform: {
        type: "string",
        enum: ["discord", "telegram", "sms", "email"],
        description: "Where to send. Must be configured.",
      },
      text: {
        type: "string",
        description: "The message to send. Keep it short.",
      },
    },
    required: ["platform", "text"],
  },
};

const MESSAGE_IAN_TOOL = {
  type: "function",
  name: "message_ian",
  description:
    "Same as send_message. Ping Ian on a configured channel when he asked (“text me”, “message me on discord”).",
  parameters: {
    type: "object",
    properties: {
      platform: {
        type: "string",
        enum: ["discord", "telegram", "sms", "email"],
        description: "Where to send. Must be configured.",
      },
      text: {
        type: "string",
        description: "The message to send. Keep it short.",
      },
    },
    required: ["platform", "text"],
  },
};

const PLAY_MUSIC_TOOL = {
  type: "function",
  name: "play_music",
  description:
    "Play a music source in the background on this same voice call. Pass a direct http(s) audio URL the user gave you, or an Apple Music song or playlist query. Empty query plays nothing. The user can also play/pause/skip from the homepage without this tool. Does not open a watch tab. Voice stays up.",
  parameters: {
    type: "object",
    properties: {
      url: { type: "string", description: "Direct http(s) audio URL (mp3, m4a, aac, ogg, wav, flac)." },
      query: { type: "string", description: "Song, artist, or playlist to play on Apple Music when the account is connected." },
      song_id: { type: "string", description: "Optional Apple Music catalog song id." },
      playlist_id: { type: "string", description: "Optional Apple Music catalog or library playlist id (pl.… or p.…)." },
    },
  },
};

const STOP_MUSIC_TOOL = {
  type: "function",
  name: "stop_music",
  description: "Stop background music on this voice call. Does not hang up.",
  parameters: { type: "object", properties: {} },
};

const APPLE_MUSIC_CONNECT_TOOL = {
  type: "function",
  name: "apple_music_connect",
  description:
    "Connect the user's Apple Music account with official MusicKit. They may need to tap Connect Apple Music and sign in with Apple. Use when they ask to connect Apple Music.",
  parameters: { type: "object", properties: {} },
};

const APPLE_MUSIC_LOVE_TOOL = {
  type: "function",
  name: "apple_music_love",
  description:
    "Love/favorite a song on the user's connected Apple Music (official rating). That is a recommendation signal. Requires their account connected.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Song title and artist, e.g. Down Low Astrid S." },
      song_id: { type: "string", description: "Optional Apple Music catalog song id." },
    },
  },
};

const APPLE_MUSIC_LIBRARY_TOOL = {
  type: "function",
  name: "apple_music_library",
  description:
    "Add a song to the user's Apple Music library (official). That is a recommendation signal. Requires their account connected.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Song title and artist." },
      song_id: { type: "string", description: "Optional Apple Music catalog song id." },
    },
  },
};

const APPLE_MUSIC_PLAYLIST_TOOL = {
  type: "function",
  name: "apple_music_playlist",
  description:
    "Add a song to an Apple Music playlist on the user's account (official). Creates the playlist if needed. Recommendation signal. Requires their account connected.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "Song title and artist." },
      song_id: { type: "string", description: "Optional Apple Music catalog song id." },
      playlist: { type: "string", description: "Playlist name. Default Lexi." },
    },
  },
};

const SET_AFFECT_TOOL = {
  type: "function",
  name: "set_affect",
  description:
    "Set the affect/salience tag (1–10) on an existing fact, including name, when the user corrects intensity or emotional weight. our_song stays at 10 and cannot be lowered.",
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
  fortnite: FortniteSessionState = DEFAULT_FORTNITE_STATE,
  channels: ChannelSessionState = DEFAULT_CHANNEL_STATE,
  clientTimeZone = "",
  location: DeviceLocationState | null = null,
  music: MusicSessionState = DEFAULT_MUSIC_STATE,
  userId = "",
) {
  const admin = isAdminUserId(userId);
  return {
    type: "session.update",
    session: {
      model: REALTIME_VOICE_MODEL,
      voice: "aria",
      instructions: buildInstructions(
        memoryInstructions,
        priorChat,
        sessionId,
        toys,
        fortnite,
        channels,
        clientTimeZone,
        location,
        music,
        userId,
      ),
      reasoning: { effort: "none" },
      turn_detection: buildTurnDetection(),
      // web_search is server-side; client tools include memory, video context, generate, toys, Fortnite, and channels.
      tools: [
        { type: "web_search" },
        UPSERT_FACT_TOOL,
        SET_AFFECT_TOOL,
        GENERATE_IMAGE_TOOL,
        GENERATE_VIDEO_TOOL,
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
        ...(admin
          ? [...fortniteRealtimeTools(), SEND_MESSAGE_TOOL, MESSAGE_IAN_TOOL]
          : []),
        PLAY_MUSIC_TOOL,
        STOP_MUSIC_TOOL,
        APPLE_MUSIC_CONNECT_TOOL,
        APPLE_MUSIC_LOVE_TOOL,
        APPLE_MUSIC_LIBRARY_TOOL,
        APPLE_MUSIC_PLAYLIST_TOOL,
      ],
      audio: {
        input: buildInputAudio(TARGET_RATE),
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
  private captureMix: GainNode | null = null;
  private tabSource: MediaStreamAudioSourceNode | null = null;
  private tabGain: GainNode | null = null;
  private tabAudioActive = false;
  private pendingTabAudio: MediaStream | null = null;
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
  private expectSpokenResponse = false;
  private ignoreOutputAudio = false;
  private lastPersisted = "";
  private pendingPersist = false;
  private memoryInstructions = "";
  private priorChat = "";
  private priorTurns: ChatTurn[] = [];
  private memorySessionId: string | null = null;
  private voiceSessionId: string | null = null;
  private capAtMs: number | null = null;
  private capTimer: ReturnType<typeof setTimeout> | null = null;
  private walletLeftover = 0;
  private holdSeconds = 0;
  private extendingHold = false;
  private settlePosted = false;
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
  private pendingLiveFrames: VisionFramePart[] = [];
  private lastLiveLooks: { camera: string; screen: string } = { camera: "", screen: "" };
  private lastDecayState = "";
  private videoContextProvider: VideoContextProvider | null = null;
  private captionPacer: CaptionPacer;
  private toyControlGranted = false;
  private lastUserUtterance = "";
  private toyProviders: { lovense: boolean; joyhub: boolean } = { lovense: false, joyhub: false };
  private toyGrantChanged = false;
  private fortniteState: FortniteSessionState = { ...DEFAULT_FORTNITE_STATE };
  private fortniteStateChanged = false;
  private channelState: ChannelSessionState = { ...DEFAULT_CHANNEL_STATE };
  private musicState: MusicSessionState = { ...DEFAULT_MUSIC_STATE };
  private musicStateChanged = false;
  private coexistDucked = false;
  private clientTimeZone = detectClientTimeZone();
  private deviceLocation: DeviceLocationState | null = null;
  private lastClockLine = "";
  private clockTimer: ReturnType<typeof setInterval> | null = null;
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
  private lastFinishedResponseId: string | null = null;
  private responseCreateInFlight = false;
  private spokenCreateAttempts = 0;
  private responseCreateTimer: ReturnType<typeof setTimeout> | null = null;
  private expectStallTimer: ReturnType<typeof setTimeout> | null = null;
  private sessionUpdateDeferred = false;

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

    if (this.musicState.playing) setMediaSessionYield(true);
    applyPlayAndRecordSession();

    const ctx = createAudioContext();
    this.ctx = ctx;
    await resumeAudioContext(ctx);
    ctx.addEventListener("statechange", () => {
      void resumeAudioContext(ctx);
      if ((ctx.state as string) === "running") {
        const track = this.stream?.getAudioTracks()[0];
        if (!micTrackUsable(track) || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
          void this.reclaim();
        }
      }
    });
    this.destKeepAliveStop = startDestinationKeepAlive(ctx, isIOSWebKit());

    const toysPromise = fetchToyProviders();
    const fortnitePromise = fetchFortniteStatus();
    const channelsPromise = fetchChannelStatus();
    const appleMusicPromise = fetchAppleMusicStatus();
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
      applyPlayAndRecordSession();
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
      if (!isExclusiveMicError(error)) {
        this.fail(error);
        return;
      }
      // Game or another app has exclusive mic — stay connected; Tap to resume / auto-reclaim.
      this.handlers.onMicNeedsGesture?.();
    }

    await addCaptureWorklet(ctx);
    this.player = new PcmPlayer(ctx, TARGET_RATE);
    this.worklet = new AudioWorkletNode(ctx, "pcm-capture");
    this.worklet.port.onmessage = (event) => {
      this.onMic(event.data as Float32Array);
    };
    // Mic stays on its own MediaStream. Shared-tab soundtrack joins via captureMix.
    if (this.stream) this.rebindCapture();
    this.attachPendingTabAudio();

    this.logger.log("env", {
      ua: navigator.userAgent,
      mic_rate: this.stream?.getAudioTracks()[0]?.getSettings().sampleRate ?? ctx.sampleRate,
      mic_state: this.stream?.getAudioTracks()[0]?.readyState,
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
      audioContextState: () => this.ctx?.state,
      onCoexist: (state) => {
        this.coexistDucked = state.ducked;
        this.applyPlaybackDuck();
      },
    });

    this.toyProviders = await toysPromise;
    this.fortniteState = await fortnitePromise;
    this.channelState = await channelsPromise;
    const apple = await appleMusicPromise;
    this.musicState = { ...this.musicState, ...apple };
    this.handlers.onMusicState?.(this.musicState);
    this.openWebSocket(token, false);
    this.startClockRefresh();
  }

  setMusicPlayback(playing: boolean, title = "", source: MusicSessionState["source"] = "none") {
    this.musicState = {
      ...this.musicState,
      playing,
      title: playing ? title : "",
      source: playing ? source : "none",
    };
    this.applyPlaybackDuck();
    this.handlers.onMusicState?.(this.musicState);
    this.musicStateChanged = true;
    this.pushSilentSessionUpdate();
  }

  setAppleMusicConnected(connected: boolean) {
    if (this.musicState.appleConnected === connected) return;
    this.musicState = { ...this.musicState, appleConnected: connected };
    this.handlers.onMusicState?.(this.musicState);
    this.musicStateChanged = true;
    this.pushSilentSessionUpdate();
  }

  private applyPlaybackDuck() {
    this.player?.setDuck(this.coexistDucked || this.musicState.playing);
  }

  setDeviceLocation(location: DeviceLocationState | null) {
    if (formatDeviceLocationLine(location) === formatDeviceLocationLine(this.deviceLocation)) {
      return;
    }
    this.deviceLocation = location;
    this.pushSilentSessionUpdate();
  }

  sendText(text: string) {
    const trimmed = sanitizeUserText(text);
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
    if (shouldClaimMediaSession()) claimMediaSession();
    const ctxState = this.ctx?.state as string | undefined;
    await resumeAudioContext(this.ctx);
    if (!this.destKeepAliveStop || ctxState === "interrupted") {
      this.restartDestKeepAlive();
    }
    const track = this.stream?.getAudioTracks()[0];
    const preferred = await resolvePreferredAudioInput();
    await this.ensureMic({
      force: !micTrackUsable(track) || micNeedsReroute(track, preferred?.deviceId),
    });
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
    if (this.stopped || !parts.length) return;
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.pendingLiveFrames = mergeLiveVisionParts(this.pendingLiveFrames, parts);
      return;
    }
    if (shouldDeferLiveVision(this.phase, Boolean(options?.respond), parts.map((part) => part.source))) {
      this.deferredLiveFrames = mergeLiveVisionParts(this.deferredLiveFrames, parts);
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
      content.push({ type: "input_image", image_url: part.dataUrl, detail: "high" });
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
        labels.push("Live 30fps camera video (exactly what the camera sees).");
      } else {
        labels.push("Live shared-tab video (exactly what the user is viewing).");
      }
    }
    this.logger.log("vision.frame", {
      source: parts.map((part) => part.source).join("+"),
      images: parts.length,
      bytes,
      respond: Boolean(options?.respond),
    });
    const hasCamera = parts.some((part) => part.source === "camera");
    const hasScreen = parts.some((part) => part.source === "screen");
    const preface = options?.prompt?.trim()
      ? `${options.prompt.trim()} `
      : watchTotal
        ? "The user is watching a video with you. These are separate recent stills from that video. Talk while it plays. On-screen voices are not the user. Soundtrack may be absent — it plays in the watch tab. "
        : uploadTotal
          ? "USER UPLOADED VIDEO, analyze these frames. "
          : hasCamera && hasScreen
            ? "Two live 30fps video streams at the same moment: camera and shared tab. Analyze both. Do not drop either stream. "
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

  sendLiveLook(source: "camera" | "screen", dataUrl: string, description: string, speak = false) {
    if (this.stopped || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!dataUrl.startsWith("data:image/")) return;
    const label = source === "camera" ? "CAMERA" : "SHARED TAB";
    if (description.trim()) this.lastLiveLooks[source] = description.trim();
    const text = description.trim()
      ? `${label} NOW (authoritative — you can see this; never ask the user to describe it):\n${description.trim()}`
      : `${label} image attached. You can see this. Read the image yourself. Never ask the user what is on the ${source === "camera" ? "camera" : "shared tab"}.`;
    this.logger.log("vision.look", { source, hasDescription: Boolean(description.trim()), speak });
    this.send(
      {
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [
            { type: "input_image", image_url: dataUrl, detail: "high" },
            { type: "input_text", text },
          ],
        },
      },
      true,
    );
    if (speak) this.requestSpokenResponse();
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

  /** Shared-tab soundtrack only — never added to the mic MediaStream. */
  setSharedTabAudio(stream: MediaStream | null) {
    this.clearSharedTabAudio();
    this.pendingTabAudio = stream;
    this.attachPendingTabAudio();
  }

  sendGeneratedStill(dataUrl: string, note?: string) {
    if (this.stopped || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!dataUrl.startsWith("data:image/")) return;
    this.send(
      {
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [
            { type: "input_image", image_url: dataUrl },
            {
              type: "input_text",
              text: note?.trim() || "You generated this image. It is on screen. Look at it.",
            },
          ],
        },
      },
      true,
    );
  }

  notifyGeneratedReady(item: GeneratedMediaItem) {
    if (this.stopped) return;
    if (item.kind === "image" && item.dataUrl) {
      this.sendGeneratedStill(item.dataUrl);
      return;
    }
    if (item.kind !== "video" || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const text =
      item.status === "done"
        ? "The generated video is ready and showing on screen."
        : item.error
          ? `Video generation failed: ${item.error}`
          : "";
    if (!text) return;
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
    this.requestSpokenResponse();
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
    const frames = this.pendingLiveFrames;
    this.pendingLiveFrames = [];
    if (frames.length) this.sendVisionFrames(frames);
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
        ? "The user started the camera. You can see the live camera. Never ask them to describe what the camera shows. Call get_video_context if you need a fresh read. Comment only when relevant."
        : "The user started sharing a browser tab or screen. You can see that live share. Never ask them to describe what is on screen. Call get_video_context if you need a fresh read. Shared-tab soundtrack is not the user. Comment only when relevant."
      : source === "camera"
        ? "The user stopped the camera. You can no longer see the live camera video."
        : "The user stopped screen sharing. You can no longer see or hear the shared tab.";
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

  notifyDualLiveVision() {
    if (this.stopped || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.logger.log("vision.state", { source: "camera+screen", active: true });
    this.send(
      {
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Camera and shared tab are both live. You can see both. Analyze each yourself. Never ask the user to describe either stream.",
            },
          ],
        },
      },
      true,
    );
  }

  private settlePromise: Promise<void> | null = null;

  stop(by: "client" | "error" = "client") {
    if (this.stopped) return this.settlePromise ?? Promise.resolve();
    this.stopped = true;
    this.emitToyControlPending(false);
    this.stopClockRefresh();
    if (this.capTimer) {
      clearTimeout(this.capTimer);
      this.capTimer = null;
    }
    this.extendingHold = false;
    this.walletLeftover = 0;
    this.holdSeconds = 0;
    this.settlePromise = this.postVoiceSettle();
    const settled = this.settlePromise;
    writePreviousSessionId(null);
    writeVoiceSessionStore({
      previousSessionId: null,
      voiceSessionId: null,
      started: false,
      rows: [],
      caption: "",
    });
    this.pendingVisionNotices = [];
    this.pendingVideoNotices = [];
    this.pendingAttachments = [];
    this.deferredLiveFrames = [];
    this.pendingLiveFrames = [];
    this.lastLiveLooks = { camera: "", screen: "" };
    this.videoContextProvider = null;
    this.by = by;
    this.logger.log("stop", { by, phase: this.phase });
    this.clearReconnect();
    this.keepAliveStop?.();
    this.keepAliveStop = null;
    setCarAudioRoute(false);
    this.destKeepAliveStop?.();
    this.destKeepAliveStop = null;
    this.captionPacer.stop();
    this.clearTurnWatchdogs();
    this.activeResponseId = null;
    this.lastFinishedResponseId = null;
    this.responseCreateInFlight = false;
    this.spokenCreateAttempts = 0;
    this.sessionUpdateDeferred = false;
    this.flushInWindow(true);
    this.player?.stop();
    this.clearSharedTabAudio();
    this.pendingTabAudio = null;
    this.worklet?.port.close();
    this.worklet?.disconnect();
    this.source?.disconnect();
    try {
      this.captureMix?.disconnect();
    } catch {
      // already disconnected
    }
    this.captureMix = null;
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
    return settled;
  }

  private async fetchSessionToken(resume: boolean, extend = false) {
    const tokenStarted = Date.now();
    const userId = clientUserId();
    if (!resume) {
      // Fresh Call after hangup: never chain previousSessionId or prior transcript.
      clearCallContinuityStore();
      this.priorChat = "";
      this.priorTurns = [];
      this.rows = [];
      this.voiceSessionId = null;
      this.capAtMs = null;
      this.walletLeftover = 0;
      this.holdSeconds = 0;
      this.settlePosted = false;
      this.setMemorySessionId(newMemorySessionId(), userId);
      const response = await this.postRealtimeSession({
        sessionId: this.memorySessionId,
        logSessionId: this.id,
        userId,
        previousSessionId: null,
      });
      const body = await this.readSessionBody(response);
      if (response.status === 402 || body.code === "out_of_minutes") {
        const err = new Error("Out of minutes.");
        this.logger.error("token", err, { ms: Date.now() - tokenStarted, status: 402 });
        throw err;
      }
      if (!response.ok || !body.token) {
        this.logger.error("token", new Error(body.error || "token"), { ms: Date.now() - tokenStarted });
        throw new Error(body.error || "Could not start a voice session.");
      }
      this.memoryInstructions =
        typeof body.memoryInstructions === "string" ? body.memoryInstructions : "";
      if (typeof body.decayState === "string" && body.decayState.trim()) {
        this.lastDecayState = body.decayState;
      }
      this.priorChat = "";
      this.priorTurns = [];
      this.seedPriorTranscripts();
      this.setMemorySessionId(body.sessionId ?? this.memorySessionId, userId);
      this.applyHold(body);
      writeVoiceSessionStore({
        sessionId: this.memorySessionId,
        previousSessionId: null,
        voiceSessionId: this.voiceSessionId,
        started: true,
        userId,
        rows: [],
        caption: "",
      });
      this.logger.log("token.ok", {
        ms: Date.now() - tokenStarted,
        decay: typeof body.decayState === "string" ? body.decayState : undefined,
        memories: this.memoryInstructions ? this.memoryInstructions.length : 0,
        prior_turns: 0,
        memory_session: this.memorySessionId ?? undefined,
        voice_session: this.voiceSessionId ?? undefined,
        hold_seconds: body.holdSeconds,
      });
      return body.token;
    }

    const response = await this.postRealtimeSession({
      sessionId: this.memorySessionId,
      logSessionId: this.id,
      userId,
      previousSessionId: null,
      voiceSessionId: this.voiceSessionId,
      resume: true,
      extend: extend || undefined,
    });
    const body = await this.readSessionBody(response);
    if (response.status === 402 || body.code === "out_of_minutes") {
      throw new Error("Out of minutes.");
    }
    if (!response.ok || !body.token) {
      this.logger.error(extend ? "token.extend" : "token.resume", new Error(body.error || "token"), {
        ms: Date.now() - tokenStarted,
      });
      throw new Error(body.error || "Could not resume the voice session.");
    }
    if (typeof body.memoryInstructions === "string") {
      this.memoryInstructions = body.memoryInstructions;
    }
    this.applyHold(body);
    // Keep in-call prior on reconnect; hangup already cleared it for the next Call.
    this.setMemorySessionId(body.sessionId ?? this.memorySessionId, userId);
    this.logger.log(extend ? "token.extend" : "token.resume", {
      ms: Date.now() - tokenStarted,
      memory_session: this.memorySessionId ?? undefined,
      voice_session: this.voiceSessionId ?? undefined,
      hold_seconds: body.holdSeconds,
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
      code?: string;
      decayState?: string;
      memoryInstructions?: string;
      priorChat?: string;
      priorTurns?: unknown;
      sessionId?: string | null;
      voiceSessionId?: string | null;
      holdSeconds?: number;
      voiceSeconds?: number;
      capAtMs?: number;
    };
  }

  private applyHold(body: {
    voiceSessionId?: string | null;
    holdSeconds?: number;
    voiceSeconds?: number;
    capAtMs?: number;
  }) {
    if (typeof body.voiceSessionId === "string" && body.voiceSessionId) {
      this.voiceSessionId = body.voiceSessionId;
    }
    if (typeof body.holdSeconds === "number" && Number.isFinite(body.holdSeconds)) {
      this.holdSeconds = Math.max(0, Math.floor(body.holdSeconds));
    }
    if (typeof body.voiceSeconds === "number" && Number.isFinite(body.voiceSeconds)) {
      this.walletLeftover = Math.max(0, Math.floor(body.voiceSeconds));
    }
    if (typeof body.capAtMs === "number" && Number.isFinite(body.capAtMs)) {
      this.capAtMs = body.capAtMs;
    }
    this.handlers.onWallet?.({
      voiceSeconds: this.walletLeftover,
      holdSeconds: this.holdSeconds,
      capAtMs: this.capAtMs,
    });
    this.armCapHangup();
  }

  private armCapHangup() {
    if (this.capTimer) {
      clearTimeout(this.capTimer);
      this.capTimer = null;
    }
    if (!this.capAtMs) return;
    const wait = Math.max(0, this.capAtMs - Date.now());
    // Roll another 90s slice ~12s before the token/hold dies so paid Calls
    // last for leftover minutes instead of hanging up at the first hold.
    const lead = 12_000;
    if (this.walletLeftover > 0) {
      this.capTimer = setTimeout(() => {
        void this.extendHoldAndRemint();
      }, Math.max(0, wait - lead));
      return;
    }
    this.capTimer = setTimeout(() => {
      this.logger.log("voice.cap", { capAtMs: this.capAtMs, leftover: this.walletLeftover });
      this.fail(new Error("Out of minutes."));
    }, wait);
  }

  private async extendHoldAndRemint() {
    if (this.stopped || this.extendingHold) return;
    this.extendingHold = true;
    this.logger.log("voice.extend", { leftover: this.walletLeftover, capAtMs: this.capAtMs });
    try {
      const token = await this.fetchSessionToken(true, true);
      if (this.stopped) return;
      this.openWebSocket(token, true);
    } catch (error) {
      this.logger.error("voice.extend", error);
      this.fail(error);
    } finally {
      this.extendingHold = false;
    }
  }

  private postVoiceSettle() {
    if (this.settlePosted || !this.voiceSessionId) return Promise.resolve();
    this.settlePosted = true;
    const voiceSessionId = this.voiceSessionId;
    const userId = clientUserId();
    const post = (): Promise<Response> =>
      fetch("/api/voice/settle", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "x-lexi-user-id": userId,
          "ngrok-skip-browser-warning": "1",
        },
        body: JSON.stringify({ voiceSessionId, userId }),
        keepalive: true,
      });
    const attempt = (left: number): Promise<void> =>
      post()
        .then((response) => {
          if (response.ok || response.status === 404) return;
          if (left <= 0) return;
          return new Promise<void>((resolve) => {
            setTimeout(() => resolve(attempt(left - 1)), 400);
          });
        })
        .catch(() => {
          if (left <= 0) return;
          return new Promise<void>((resolve) => {
            setTimeout(() => resolve(attempt(left - 1)), 400);
          });
        });
    return attempt(4);
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
      this.expectSpokenResponse = false;
      this.responseCreateInFlight = false;
      this.spokenCreateAttempts = 0;
      this.clearTurnWatchdogs();
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
      try {
        this.onServer(payload);
      } catch (error) {
        this.logger.error("server", error);
        this.releaseSpokenTurn("handler");
      }
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

  private captureDestination() {
    if (this.captureMix) return this.captureMix;
    if (!this.ctx || !this.worklet) return null;
    this.captureMix = this.ctx.createGain();
    this.captureMix.gain.value = 1;
    this.captureMix.connect(this.worklet);
    return this.captureMix;
  }

  private attachPendingTabAudio() {
    const stream = this.pendingTabAudio;
    if (!stream || this.stopped || !this.ctx || !this.worklet) return;
    const tracks = stream.getAudioTracks().filter((track) => track.readyState === "live");
    if (!tracks.length) {
      this.logger.log("share.audio.none", {});
      return;
    }
    const dest = this.captureDestination();
    if (!dest) return;
    this.tabSource = this.ctx.createMediaStreamSource(new MediaStream(tracks));
    this.tabGain = this.ctx.createGain();
    this.tabGain.gain.value = 1;
    this.tabSource.connect(this.tabGain);
    this.tabGain.connect(dest);
    this.tabAudioActive = true;
    this.rebindCapture();
    this.logger.log("share.audio.on", {
      tracks: tracks.length,
      label: tracks[0]?.label ?? "",
    });
  }

  private clearSharedTabAudio() {
    try {
      this.tabSource?.disconnect();
    } catch {
      // already disconnected
    }
    try {
      this.tabGain?.disconnect();
    } catch {
      // already disconnected
    }
    this.tabSource = null;
    this.tabGain = null;
    this.tabAudioActive = false;
  }

  private rebindCapture() {
    if (this.stopped || !this.ctx || !this.stream || !this.worklet) return;
    try {
      this.source?.disconnect();
    } catch {
      // already disconnected
    }
    const dest = this.captureDestination() ?? this.worklet;
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.source.connect(dest);
  }

  private bindMic(stream: MediaStream) {
    const track = stream.getAudioTracks()[0];
    if (!track) return;
    applyMicTrackHints(track);
    track.onended = () => {
      this.logger.log("mic.ended", {});
      if (!this.voiceAudioInterrupted()) void this.ensureMic({ force: true });
    };
    track.onmute = () => {
      this.logger.log("mic.mute", {});
      const car = isCarLikeAudioInput(track.label);
      window.setTimeout(() => {
        if (this.stopped || this.voiceAudioInterrupted()) return;
        const live = this.stream?.getAudioTracks()[0];
        void this.ensureMic({ force: !micTrackUsable(live) });
      }, muteReclaimDelayMs(car));
    };
    track.onunmute = () => {
      void applyMicConstraints(track);
      this.handlers.onMicRecovered?.();
    };
  }

  private voiceAudioInterrupted() {
    return isVoiceAudioInterrupted({
      audioContextState: this.ctx?.state,
      yieldToMedia: isMediaSessionYielded() || this.musicState.playing,
    });
  }

  private async ensureMic(opts: { force?: boolean } = {}) {
    if (this.stopped || !this.ctx) return;
    if (this.voiceAudioInterrupted()) return;
    const track = this.stream?.getAudioTracks()[0];
    const preferred = await resolvePreferredAudioInput();
    const needsRoute = micNeedsReroute(track, preferred?.deviceId);
    if (!opts.force && micTrackUsable(track) && !needsRoute) {
      await applyMicConstraints(track);
      this.handlers.onMicRecovered?.();
      return;
    }
    try {
      const next = await openUserMicWithRetry();
      this.source?.disconnect();
      this.stream?.getTracks().forEach((item) => item.stop());
      this.stream = next;
      this.bindMic(next);
      if (this.worklet) this.rebindCapture();
      this.logger.log("mic.reacquire", {
        label: next.getAudioTracks()[0]?.label ?? "",
        state: next.getAudioTracks()[0]?.readyState,
        device_id: next.getAudioTracks()[0]?.getSettings().deviceId ?? "",
      });
      this.handlers.onMicRecovered?.();
    } catch (error) {
      this.logger.error("mic.reacquire", error);
      if (isExclusiveMicError(error)) {
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
    if (!this.tabAudioActive) {
      this.micNoiseFloor = updateMicNoiseFloor(this.micNoiseFloor, pcm.rms);
    }
    const primary = isPrimaryMicEnergy(pcm.rms, this.micNoiseFloor);
    // Shared-tab soundtrack stays in the mix so Lexi can hear it. Mic-only
    // silence still gates room hiss when nothing is shared.
    const keep = primary || this.tabAudioActive;
    const audio = pcm16ToBase64(keep ? pcm.bytes : new Uint8Array(pcm.bytes.length));
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
        this.expectSpokenResponse = true;
        this.ignoreOutputAudio = true;
        this.responseCreateInFlight = false;
        this.activeResponseId = null;
        this.spokenCreateAttempts = 0;
        const dropped = this.player?.flush() ?? 0;
        this.send({ type: "response.cancel" });
        this.logger.log("play.stop", { reason: "barge-in", dropped_ms: dropped });
        this.captionPacer.stop();
        this.armExpectWatchdog();
        // Barge-in cancels Lexi's speech only. Never pause or stop a watch-together video.
        this.setPhase("listening");
        break;
      }
      case "input_audio_buffer.speech_stopped":
        this.speechStoppedT = Date.now();
        this.expectSpokenResponse = true;
        this.armExpectWatchdog();
        this.setPhase("thinking");
        break;
      case "input_audio_buffer.timeout_triggered":
        this.expectSpokenResponse = false;
        this.ignoreOutputAudio = true;
        this.clearTurnWatchdogs();
        this.send({ type: "response.cancel" });
        this.player?.flush();
        this.captionPacer.stop();
        this.setPhase("listening");
        this.logger.log("play.stop", { reason: "idle-timeout" });
        break;
      case "input_audio_buffer.committed": {
        const itemId = typeof event.item_id === "string" ? event.item_id : crypto.randomUUID();
        this.upsert({ id: itemId, role: "user", text: "" });
        break;
      }
      case "conversation.item.input_audio_transcription.updated":
      case "conversation.item.input_audio_transcription.completed": {
        const { itemId, transcript } = readUserTranscript(event);
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
        this.responseCreateInFlight = false;
        this.spokenCreateAttempts = 0;
        this.clearResponseCreateWatchdog();
        if (!this.expectSpokenResponse) {
          this.ignoreOutputAudio = true;
          this.send({ type: "response.cancel" });
          this.player?.flush();
          this.captionPacer.stop();
          this.activeResponseId = null;
          this.setPhase("listening");
          this.logger.log("play.stop", { reason: "unprompted" });
          break;
        }
        this.ignoreOutputAudio = false;
        const previousId = previousIdForHandoff(this.activeResponseId, this.lastFinishedResponseId);
        const claim = claimExclusiveSpeech(previousId, incomingId ?? PENDING_SPEECH_ID);
        const handoff = decidePlaybackHandoff({
          takeFloor: claim.takeFloor,
          previousActiveId: previousId,
          incomingId: incomingId ?? PENDING_SPEECH_ID,
          queuedMs: this.player?.queuedMs ?? 0,
        });
        if (handoff === "replace") {
          const dropped = this.player?.flush() ?? 0;
          if (dropped) this.logger.log("play.stop", { reason: "exclusive", dropped_ms: dropped });
          this.player?.resetTurn();
        } else if (handoff === "reset") {
          this.player?.resetTurn();
        }
        this.captionPacer.reset();
        this.activeResponseId = claim.activeId;
        this.createdT = Date.now();
        this.firstAudio = false;
        this.outDeltas = 0;
        this.outBytes = 0;
        this.toolsThisResponse = false;
        this.factWriteSucceeded = false;
        this.armExpectWatchdog();
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
      case "response.done":
      case "response.cancelled":
      case "response.failed": {
        this.onResponseTerminal(event);
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
        this.responseCreateInFlight = false;
        this.clearResponseCreateWatchdog();
        if (isIgnorableRealtimeError(message)) break;
        if (isRecoverableRealtimeError(message)) {
          this.logger.log("turn.recover", { reason: "error", message });
          if (this.expectSpokenResponse && !this.activeResponseId) {
            this.requestSpokenResponse();
          } else if (!this.expectSpokenResponse) {
            this.releaseSpokenTurn("error");
          }
          break;
        }
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
    if (!userId) return;
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
      result = await raceTimeout(this.executeClientTool(name, args), TOOL_CALL_TIMEOUT_MS, {
        error: "Tool timed out.",
      });
    } catch (error) {
      result = { error: error instanceof Error ? error.message : "Tool call failed." };
      this.logger.error("memory.tool", error, { name, call_id: id });
    }

    if (!this.stopped && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.expectSpokenResponse = true;
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
    this.toolResponseWaiting = true;
    this.flushToolBatch();
  }

  private async executeClientTool(name: string, args: Record<string, unknown>) {
    if (name === "request_toy_control") {
      const requested = args.granted !== false && args.granted !== "false";
      const resolved = resolveToyControlRequest({
        requested,
        lastUserUtterance: this.lastUserUtterance,
        alreadyGranted: this.toyControlGranted,
      });
      if (!resolved.ok) {
        if (requested && !this.toyControlGranted) this.emitToyControlPending(true);
        return {
          ok: false,
          controlGranted: this.toyControlGranted,
          error: resolved.error,
        };
      }
      return this.applyUserToyControl(resolved.granted);
    }
    if (
      name === "toy_command" ||
      name === "lovense_function" ||
      name === "lovense_vibrate" ||
      name === "lovense_stop" ||
      name === "lovense_pattern" ||
      name === "joyhub_vibrate" ||
      name === "joyhub_stop" ||
      name === "joyhub_pattern"
    ) {
      return this.runToyCommand(name, args);
    }
    if (name === "get_video_context") {
      return this.runVideoContext(typeof args.question === "string" ? args.question : "");
    }
    if (name === "generate_image") {
      return this.runGenerateImage(args);
    }
    if (name === "generate_video") {
      return this.runGenerateVideo(args);
    }
    if (
      name === "fortnite_add_friend" ||
      name === "fortnite_status" ||
      name === "fortnite_invite" ||
      name === "fortnite_sign_in" ||
      name === "fortnite_join_party" ||
      name === "fortnite_sit_out" ||
      name === "fortnite_leave_party"
    ) {
      return this.runFortniteTool(name, args);
    }
    if (name === "send_message" || name === "message_ian") {
      return this.runChannelSend(args);
    }
    if (
      name === "play_music" ||
      name === "stop_music" ||
      name === "apple_music_connect" ||
      name === "apple_music_love" ||
      name === "apple_music_library" ||
      name === "apple_music_playlist"
    ) {
      return this.runMusicTool(name, args);
    }
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
      let result: Record<string, unknown> = {};
      try {
        result = (await response.json()) as Record<string, unknown>;
      } catch {
        result = { error: `Memory store returned ${response.status}.` };
      }
      if (!response.ok) {
        this.logger.log("memory.tool.fail", { name, status: response.status, error: result.error });
        return result;
      }
      const fact = (result.fact ?? null) as Record<string, unknown> | null;
      if (fact) this.applyStoredFact(fact);
      this.factWriteSucceeded = true;
      this.logger.log("memory.tool.ok", {
        name,
        memory_key: fact?.memory_key,
        affect: fact?.affect,
      });
      return result;
    }
    return { error: `Unknown function: ${name}` };
  }

  private flushToolBatch() {
    if (this.inflightTools.size > 0 || !this.toolResponseWaiting) return;
    this.toolResponseWaiting = false;
    if (this.stopped || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.factWriteSucceeded || this.toyGrantChanged || this.fortniteStateChanged || this.musicStateChanged) {
      this.toyGrantChanged = false;
      this.fortniteStateChanged = false;
      this.musicStateChanged = false;
      this.sessionUpdateDeferred = true;
    }
    this.requestSpokenResponse({ ifActive: "skip" });
  }

  private requestSpokenResponse(opts?: { ifActive?: "skip" | "replace" }) {
    if (this.stopped || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.expectSpokenResponse = true;
    const decision =
      opts?.ifActive === "skip"
        ? decideToolFollowUpCreate({
            createInFlight: this.responseCreateInFlight,
            activeId: this.activeResponseId,
            finishedId: this.lastFinishedResponseId,
          })
        : decideResponseCreate({
            createInFlight: this.responseCreateInFlight,
            hasActiveResponse: this.activeResponseId !== null,
            ifActive: opts?.ifActive ?? "replace",
          });
    if (decision === "skip") {
      this.armExpectWatchdog();
      return;
    }
    if (decision === "replace") {
      this.send({ type: "response.cancel" });
      this.ignoreOutputAudio = true;
      const dropped = this.player?.flush() ?? 0;
      this.logger.log("play.stop", { reason: "replace", dropped_ms: dropped });
      this.captionPacer.reset();
      this.activeResponseId = null;
    }
    this.responseCreateInFlight = true;
    this.spokenCreateAttempts += 1;
    // Car Bluetooth adds its own latency — never insert a client wait here.
    void responseCreateDelayMs({ carAudio: isCarAudioRoute() });
    this.send({ type: "response.create" });
    this.armResponseCreateWatchdog();
    this.armExpectWatchdog();
    this.setPhase("thinking");
  }

  private onResponseTerminal(event: Record<string, unknown>) {
    const response = (event.response ?? {}) as Record<string, unknown>;
    const responseId = readResponseId(event) ?? (typeof response.id === "string" ? response.id : "");
    this.lastFinishedResponseId = responseId || this.activeResponseId;
    if (
      shouldReleaseSpeechFloor({
        activeId: this.activeResponseId,
        doneId: responseId || null,
      })
    ) {
      this.activeResponseId = null;
    }
    this.responseCreateInFlight = false;
    this.clearResponseCreateWatchdog();
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
    const terminal = status === "cancelled" || status === "failed" || status === "error";
    const awaitingTools = this.toolsThisResponse && !terminal;
    if (awaitingTools) {
      this.toolResponseWaiting = true;
      this.armExpectWatchdog();
      this.flushToolBatch();
    } else {
      this.toolResponseWaiting = false;
      if (
        shouldClearExpectAfterDone({
          toolsThisResponse: this.toolsThisResponse,
          inflightTools: this.inflightTools.size,
          toolResponseWaiting: this.toolResponseWaiting,
          status,
        })
      ) {
        this.expectSpokenResponse = false;
        this.clearExpectWatchdog();
      }
      this.setPhase("listening");
    }
    if (!terminal) {
      if (!awaitingTools) void this.refreshDecayState();
      this.captionPacer.flush();
    } else {
      this.expectSpokenResponse = false;
      this.clearExpectWatchdog();
      this.captionPacer.stop();
    }
    if (!terminal && status !== "incomplete") {
      this.pendingPersist = true;
      this.persistTurn();
    }
  }

  private armResponseCreateWatchdog() {
    this.clearResponseCreateWatchdog();
    this.responseCreateTimer = setTimeout(() => {
      this.responseCreateTimer = null;
      if (this.stopped || !this.responseCreateInFlight) return;
      this.logger.log("turn.recover", {
        reason: "create_stall",
        attempts: this.spokenCreateAttempts,
      });
      this.responseCreateInFlight = false;
      if (this.spokenCreateAttempts >= 2) {
        this.releaseSpokenTurn("create_stall");
        void this.reconnectSocket();
        return;
      }
      this.requestSpokenResponse();
    }, RESPONSE_CREATE_STALL_MS);
  }

  private armExpectWatchdog() {
    this.clearExpectWatchdog();
    this.expectStallTimer = setTimeout(() => {
      this.expectStallTimer = null;
      if (this.stopped || !this.expectSpokenResponse) return;
      if (this.phase === "speaking" && (this.player?.queuedMs ?? 0) > 0) return;
      if (this.inflightTools.size > 0) {
        this.armExpectWatchdog();
        return;
      }
      if (this.responseCreateInFlight) return;
      if (this.activeResponseId && this.activeResponseId !== PENDING_SPEECH_ID) return;
      if (this.toolResponseWaiting || this.activeResponseId === PENDING_SPEECH_ID) {
        this.logger.log("turn.recover", { reason: "expect_stall_create" });
        this.responseCreateInFlight = false;
        this.activeResponseId =
          this.activeResponseId === PENDING_SPEECH_ID ? null : this.activeResponseId;
        this.requestSpokenResponse();
        return;
      }
      this.logger.log("turn.recover", { reason: "expect_stall" });
      this.requestSpokenResponse();
    }, EXPECT_STALL_MS);
  }

  private releaseSpokenTurn(reason: string) {
    this.logger.log("turn.recover", { reason });
    this.expectSpokenResponse = false;
    this.responseCreateInFlight = false;
    this.toolResponseWaiting = false;
    this.ignoreOutputAudio = false;
    this.activeResponseId = null;
    this.spokenCreateAttempts = 0;
    this.clearTurnWatchdogs();
    this.captionPacer.stop();
    this.setPhase("listening");
  }

  private clearResponseCreateWatchdog() {
    if (this.responseCreateTimer) {
      clearTimeout(this.responseCreateTimer);
      this.responseCreateTimer = null;
    }
  }

  private clearExpectWatchdog() {
    if (this.expectStallTimer) {
      clearTimeout(this.expectStallTimer);
      this.expectStallTimer = null;
    }
  }

  private clearTurnWatchdogs() {
    this.clearResponseCreateWatchdog();
    this.clearExpectWatchdog();
  }

  private sessionUpdate() {
    const decay = this.lastDecayState.trim()
      ? `${this.memoryInstructions}\n\nCURRENT DECAY STATE: ${this.lastDecayState}`
      : this.memoryInstructions;
    return buildSessionUpdate(
      decay,
      this.priorChat,
      this.currentSessionId() ?? "",
      {
        lovense: this.toyProviders.lovense,
        joyhub: this.toyProviders.joyhub,
        granted: this.toyControlGranted,
      },
      this.fortniteState,
      this.channelState,
      this.clientTimeZone,
      this.deviceLocation,
      this.musicState,
      clientUserId(),
    );
  }

  private voiceTimeZone() {
    return resolveVoiceTimeZone(this.memoryInstructions, this.clientTimeZone);
  }

  private startClockRefresh() {
    this.stopClockRefresh();
    this.lastClockLine = formatCurrentTimeLine(this.voiceTimeZone());
    this.clockTimer = setInterval(() => this.refreshClock(), CLOCK_REFRESH_MS);
  }

  private stopClockRefresh() {
    if (this.clockTimer) {
      clearInterval(this.clockTimer);
      this.clockTimer = null;
    }
  }

  private refreshClock(force = false) {
    if (this.stopped || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!force && (this.phase === "thinking" || this.phase === "speaking")) return;
    const line = formatCurrentTimeLine(this.voiceTimeZone());
    if (!force && line === this.lastClockLine) return;
    this.lastClockLine = line;
    this.pushSilentSessionUpdate();
  }

  private pushSilentSessionUpdate() {
    if (this.stopped || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.decayUpdateWouldStallSpeech()) {
      this.sessionUpdateDeferred = true;
      return;
    }
    this.sessionUpdateDeferred = false;
    this.send(this.sessionUpdate(), true);
  }

  private flushDeferredSessionUpdate() {
    if (!this.sessionUpdateDeferred) return;
    this.sessionUpdateDeferred = false;
    if (this.decayUpdateWouldStallSpeech()) {
      this.sessionUpdateDeferred = true;
      return;
    }
    this.pushSilentSessionUpdate();
  }

  private applyUserToyControl(granted: boolean) {
    if (this.toyControlGranted !== granted) {
      this.toyControlGranted = granted;
      this.toyGrantChanged = true;
      this.logger.log("toys.control", { granted, source: "user" });
      this.pushSilentSessionUpdate();
      if (!granted) {
        void this.runToyCommand("toy_command", { action: "stop" });
      }
    }
    this.emitToyControlPending(false);
    this.handlers.onToyControl?.(granted);
    return { ok: true, controlGranted: granted, source: "user" };
  }

  private emitToyControlPending(pending: boolean) {
    this.handlers.onToyControlRequest?.(pending);
  }

  private emitGeneratedMedia(item: GeneratedMediaItem) {
    this.handlers.onGeneratedMedia?.(item);
    if (item.kind === "image" && item.status === "done" && item.dataUrl) {
      this.sendGeneratedStill(item.dataUrl);
    }
  }

  private async runGenerateImage(args: Record<string, unknown>) {
    const prompt = readGeneratePrompt(args);
    if (!prompt) return { ok: false, error: "Prompt is required." };
    const response = await fetch("/api/generate/image", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "1",
      },
      body: JSON.stringify({
        prompt,
        aspect_ratio: args.aspect_ratio ?? args.aspectRatio,
        resolution: args.resolution,
      }),
    });
    let body: Record<string, unknown> = {};
    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    if (!response.ok) {
      const error = typeof body.error === "string" ? body.error : "Could not generate an image.";
      this.logger.log("generate.image.fail", { status: response.status, error });
      this.emitGeneratedMedia({
        id: crypto.randomUUID(),
        kind: "image",
        prompt,
        status: "failed",
        error,
      });
      return { ok: false, error, configured: body.configured };
    }
    const dataUrl = typeof body.dataUrl === "string" ? body.dataUrl : undefined;
    const url = typeof body.url === "string" ? body.url : undefined;
    const model = typeof body.model === "string" ? body.model : undefined;
    this.emitGeneratedMedia({
      id: crypto.randomUUID(),
      kind: "image",
      prompt,
      status: "done",
      dataUrl,
      url,
      model,
    });
    this.logger.log("generate.image.ok", { model, has_data: Boolean(dataUrl || url) });
    return {
      ok: true,
      kind: "image",
      prompt,
      model,
      on_screen: true,
      message: "The photo is on screen.",
    };
  }

  private async runGenerateVideo(args: Record<string, unknown>) {
    const prompt = readGeneratePrompt(args);
    if (!prompt) return { ok: false, error: "Prompt is required." };
    const response = await fetch("/api/generate/video", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "1",
      },
      body: JSON.stringify({
        prompt,
        duration: args.duration,
        aspect_ratio: args.aspect_ratio ?? args.aspectRatio,
        resolution: args.resolution,
        silent: args.silent,
      }),
    });
    let body: Record<string, unknown> = {};
    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch {
      body = {};
    }
    const requestId = typeof body.requestId === "string" ? body.requestId : undefined;
    const url = typeof body.url === "string" ? body.url : undefined;
    const model = typeof body.model === "string" ? body.model : undefined;
    const status =
      body.status === "done" ? "done" : body.status === "failed" ? "failed" : "pending";
    if (!response.ok && status !== "pending") {
      const error = typeof body.error === "string" ? body.error : "Could not generate a video.";
      this.logger.log("generate.video.fail", { status: response.status, error });
      this.emitGeneratedMedia({
        id: requestId || crypto.randomUUID(),
        kind: "video",
        prompt,
        status: "failed",
        requestId,
        error,
        model,
      });
      return { ok: false, error, configured: body.configured };
    }
    const item: GeneratedMediaItem = {
      id: requestId || crypto.randomUUID(),
      kind: "video",
      prompt,
      status,
      requestId,
      url,
      model,
      durationSec: typeof body.durationSec === "number" ? body.durationSec : undefined,
    };
    this.emitGeneratedMedia(item);
    this.logger.log("generate.video", { status, request_id: requestId, model });
    if (status === "done") {
      return {
        ok: true,
        kind: "video",
        prompt,
        model,
        on_screen: true,
        message: "The video is on screen.",
      };
    }
    return {
      ok: true,
      kind: "video",
      prompt,
      model,
      requestId,
      status: "pending",
      message: "The video is generating and will appear on screen when ready.",
    };
  }

  private noteUserToyIntent(text: string) {
    this.lastUserUtterance = text;
    const intent = parseToyControlIntent(text);
    if (intent === "grant") {
      if (!this.toyControlGranted) this.emitToyControlPending(true);
      return;
    }
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

  private async runMusicTool(name: string, args: Record<string, unknown>) {
    if (name === "stop_music") {
      await this.handlers.stopBackgroundMusic?.();
      this.setMusicPlayback(false);
      return { ok: true, playing: false };
    }
    if (name === "apple_music_connect") {
      if (!this.musicState.appleConfigured) {
        return {
          ok: false,
          configured: false,
          connected: false,
          error: "Apple Music is not configured. MusicKit developer keys still need to be added.",
        };
      }
      if (this.musicState.appleConnected) {
        return { ok: true, configured: true, connected: true };
      }
      if (!this.handlers.connectAppleMusic) {
        return {
          ok: false,
          configured: true,
          connected: false,
          error: "The user needs to tap Connect Apple Music and sign in.",
        };
      }
      const result = await this.handlers.connectAppleMusic();
      if (result.ok) this.setAppleMusicConnected(true);
      return {
        ok: result.ok,
        configured: true,
        connected: result.ok,
        error: result.error,
      };
    }
    if (name === "play_music") {
      const url = typeof args.url === "string" ? args.url.trim() : "";
      if (url) {
        const parsed = parseAudioSourceUrl(url);
        if (!parsed.ok) return { ok: false, error: parsed.error };
        if (!this.handlers.playBackgroundUrl) {
          return { ok: false, error: "Background audio is not available in this tab." };
        }
        const played = await this.handlers.playBackgroundUrl(parsed.href);
        if (!played.ok) return { ok: false, error: played.error };
        this.setMusicPlayback(true, played.title || "Audio", "url");
        return { ok: true, playing: true, source: "url", title: played.title };
      }
      if (!this.musicState.appleConfigured) {
        return {
          ok: false,
          error: "Need a direct audio URL, or Apple Music MusicKit keys plus the user connecting their account.",
        };
      }
      if (!this.musicState.appleConnected) {
        return { ok: false, error: "The user needs to tap Connect Apple Music first, or give a direct audio URL." };
      }
      const query = typeof args.query === "string" ? args.query.trim() : "";
      const songId = typeof args.song_id === "string" ? args.song_id.trim() : "";
      const playlistId =
        parseAppleMusicPlaylistId(args.playlist_id) || parseAppleMusicPlaylistIdFromInput(query);
      if (!query && !songId && !playlistId) {
        return { ok: false, error: "Need a song, playlist, or audio URL." };
      }
      const searched = await this.postAppleMusic("search", { query, songId, playlistId });
      const song = (searched.song ?? (Array.isArray(searched.songs) ? searched.songs[0] : null)) as
        | { id?: string; title?: string; artist?: string }
        | null;
      const playlist = (searched.playlist ??
        (Array.isArray(searched.playlists) ? searched.playlists[0] : null)) as
        | { id?: string; title?: string; curator?: string }
        | null;
      const resolvedPlaylistId = playlistId || (typeof playlist?.id === "string" ? playlist.id : "");
      const wantPlaylist =
        Boolean(playlistId) || looksLikePlaylistQuery(query) || (!songId && !song?.id && Boolean(resolvedPlaylistId));
      if (wantPlaylist && resolvedPlaylistId) {
        if (!this.handlers.playAppleMusicPlaylist) {
          return { ok: false, error: "Apple Music playback is not available in this tab." };
        }
        const title =
          [playlist?.title, playlist?.curator].filter(Boolean).join(" — ") || "Apple Music playlist";
        const played = await this.handlers.playAppleMusicPlaylist(resolvedPlaylistId, title);
        if (!played.ok) return { ok: false, error: played.error, playlist };
        this.setMusicPlayback(true, played.title || title, "apple");
        return { ok: true, playing: true, source: "apple", playlist };
      }
      const id = songId || (typeof song?.id === "string" ? song.id : "");
      if (!searched.ok || !id) {
        return { ok: false, error: typeof searched.error === "string" ? searched.error : "No Apple Music match." };
      }
      const title = [song?.title, song?.artist].filter(Boolean).join(" — ");
      if (!this.handlers.playAppleMusicSong) {
        return { ok: false, error: "Apple Music playback is not available in this tab." };
      }
      const played = await this.handlers.playAppleMusicSong(id, title);
      if (!played.ok) return { ok: false, error: played.error, song };
      this.setMusicPlayback(true, played.title || title, "apple");
      return { ok: true, playing: true, source: "apple", song };
    }
    const action =
      name === "apple_music_love" ? "love" : name === "apple_music_library" ? "library" : "playlist";
    const result = await this.postAppleMusic(action, {
      query: typeof args.query === "string" ? args.query : "",
      songId: typeof args.song_id === "string" ? args.song_id : "",
      playlist: typeof args.playlist === "string" ? args.playlist : "",
    });
    if (result.ok) this.setAppleMusicConnected(true);
    return result;
  }

  private async postAppleMusic(
    action: string,
    input: { query?: string; songId?: string; playlist?: string; playlistId?: string },
  ) {
    const response = await fetch("/api/apple-music", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "ngrok-skip-browser-warning": "1",
      },
      body: JSON.stringify({
        action,
        query: input.query,
        songId: input.songId,
        playlist: input.playlist,
        playlistId: input.playlistId,
      }),
    });
    try {
      return (await response.json()) as Record<string, unknown>;
    } catch {
      return { ok: false, error: `Apple Music returned ${response.status}.` };
    }
  }

  private async runFortniteTool(name: string, args: Record<string, unknown>) {
    if (!isAdminUserId(clientUserId())) {
      return { ok: false, error: "Fortnite companion tools are admin-only." };
    }
    const action =
      name === "fortnite_add_friend"
        ? "add_friend"
        : name === "fortnite_invite"
          ? "invite"
          : name === "fortnite_sign_in"
            ? "sign_in"
            : name === "fortnite_join_party"
              ? "join_party"
              : name === "fortnite_sit_out"
                ? "sit_out"
                : name === "fortnite_leave_party"
                  ? "leave_party"
                  : "status";
    const displayName =
      typeof args.display_name === "string"
        ? args.display_name
        : typeof args.displayName === "string"
          ? args.displayName
          : undefined;
    const response = await fetch("/api/fortnite", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-lexi-user-id": clientUserId(),
        "ngrok-skip-browser-warning": "1",
      },
      body: JSON.stringify({ action, displayName, userId: clientUserId() }),
    });
    let body: Record<string, unknown> = {};
    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch {
      body = { error: `Fortnite API returned ${response.status}.` };
    }
    if (!response.ok) {
      this.logger.log("fortnite.tool.fail", { name, status: response.status, error: body.error });
      return {
        ...body,
        ok: false,
        canPlayInGame: false,
        error: typeof body.error === "string" ? body.error : "Fortnite request failed.",
      };
    }
    const friend = (body.friend ?? null) as Record<string, unknown> | null;
    const lexi = (body.lexi ?? null) as Record<string, unknown> | null;
    const party = (body.party ?? null) as Record<string, unknown> | null;
    const inIanParty =
      party?.withFriend === true || party?.inIanParty === true || party?.visibleInFortnite === true;
    const next: FortniteSessionState = {
      configured: body.configured !== false,
      displayName: typeof lexi?.displayName === "string" ? lexi.displayName : this.fortniteState.displayName,
      friendDisplayName:
        typeof friend?.displayName === "string" ? friend.displayName : this.fortniteState.friendDisplayName,
      friendRelation: typeof friend?.relation === "string" ? friend.relation : this.fortniteState.friendRelation,
      friendPresence:
        friend && "presence" in friend
          ? readFriendPresence(friend.presence)
          : this.fortniteState.friendPresence,
      epicHttpReady:
        typeof body.epicHttpReady === "boolean" ? body.epicHttpReady === true : this.fortniteState.epicHttpReady,
      inParty: party ? inIanParty : this.fortniteState.inParty,
      sittingOut: party ? party.sittingOut === true && inIanParty : this.fortniteState.sittingOut,
    };
    if (
      next.configured !== this.fortniteState.configured ||
      next.displayName !== this.fortniteState.displayName ||
      next.friendDisplayName !== this.fortniteState.friendDisplayName ||
      next.friendRelation !== this.fortniteState.friendRelation ||
      next.friendPresence !== this.fortniteState.friendPresence ||
      next.epicHttpReady !== this.fortniteState.epicHttpReady ||
      next.inParty !== this.fortniteState.inParty ||
      next.sittingOut !== this.fortniteState.sittingOut
    ) {
      this.fortniteState = next;
      this.fortniteStateChanged = true;
    }
    this.logger.log("fortnite.tool.ok", { name, action, relation: next.friendRelation, sittingOut: next.sittingOut });
    return sanitizeFortniteToolResult({ ...body, ok: true, canPlayInGame: false, comms: "grok_voice" });
  }

  private async runChannelSend(args: Record<string, unknown>) {
    if (!isAdminUserId(clientUserId())) {
      return { ok: false, error: "Channel messaging is admin-only." };
    }
    const response = await fetch("/api/channels", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-lexi-user-id": clientUserId(),
        "ngrok-skip-browser-warning": "1",
      },
      body: JSON.stringify({
        platform: args.platform ?? args.channel,
        text: args.text ?? args.message,
        userId: clientUserId(),
      }),
    });
    let body: Record<string, unknown> = {};
    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch {
      body = { error: `Channel API returned ${response.status}.` };
    }
    if (!response.ok) {
      this.logger.log("channel.send.fail", { status: response.status, error: body.error });
      return {
        ...body,
        ok: false,
        error: typeof body.error === "string" ? body.error : "Could not send that message.",
      };
    }
    this.logger.log("channel.send.ok", { platform: body.platform });
    return { ...body, ok: true };
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
      if (snapshot.frames.length) {
        this.sendVisionFrames(
          snapshot.frames.map((frame) => ({
            source: "screen",
            dataUrl: frame.dataUrl,
            timeSec: frame.timeSec,
          })),
          {
            respond: true,
            prompt:
              "High-detail stills from the live shared tab the user is viewing right now. Read on-screen text and describe specific visual details from these images. Do not say frame analysis failed.",
          },
        );
        return {
          ok: true,
          fallback: "live_frames",
          title: snapshot.title,
          currentTime: snapshot.currentTime,
          duration: snapshot.duration,
          playing: snapshot.playing,
          description:
            this.lastLiveLooks.screen ||
            this.lastLiveLooks.camera ||
            "High-detail frames were just attached. Read them yourself. Never ask the user to describe the camera or shared tab.",
        };
      }
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
    const rounded = isPinnedKey(key) ? PINNED_AFFECT : Math.round(affect);
    const line = isPinnedKey(key)
      ? `${key}: ${value} (affect ${PINNED_AFFECT}/10, pinned)`
      : `${key}: ${value} (affect ${rounded}/10, decayed from ${rounded})`;
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
    // Never send decay as a user message — the model treats that as a prompt.
    this.pushSilentSessionUpdate();
  }

  private sendCachedDecay() {
    if (this.decaySentForTurn || !this.lastDecayState) return;
    this.decaySentForTurn = true;
    this.sendDecayItem(this.lastDecayState);
  }

  private decayUpdateWouldStallSpeech() {
    return this.expectSpokenResponse || this.phase === "thinking" || this.phase === "speaking";
  }

  private async refreshDecayState() {
    if (this.stopped || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (!this.decayUpdateWouldStallSpeech()) this.sendCachedDecay();
    const state = await fetchDecayStateForTurn();
    this.lastDecayState = state;
    if (this.stopped || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (this.decayUpdateWouldStallSpeech()) return;
    if (!this.decaySentForTurn) {
      this.decaySentForTurn = true;
      this.sendDecayItem(state);
    }
  }

  private emitText(text: string) {
    this.decaySentForTurn = false;
    this.refreshClock();
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
        ? " This clip has a soundtrack; it is not the user speaking."
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
    this.refreshClock();
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
    // Fresh Calls start with empty prior. Do not revive hangup-cleared transcripts.
    const seeded = turnsToTranscripts(this.priorTurns);
    this.rows = seeded.map((row) => ({ ...row }));
    this.handlers.onTranscripts(this.rows.map((row) => ({ ...row })));
    if (this.rows.length) {
      const latest = [...this.rows].reverse().find((row) => row.text.trim());
      if (latest) this.handlers.onCaption?.(latest.text);
    } else {
      this.handlers.onCaption?.("");
    }
  }

  private injectPriorChat() {
    // Prior turns already sit in session instructions. Replaying them as
    // user items makes the last line look like a new prompt.
    if (!this.priorTurns.length) return;
    this.logger.log("prior.chat", { turns: this.priorTurns.length, items: 0 });
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
    if (phase === "listening") {
      this.flushDeferredLiveFrames();
      this.flushDeferredSessionUpdate();
    }
  }

  private fail(error: unknown) {
    const message = error instanceof Error ? error.message : "Voice session failed.";
    // Keep the 402 copy exact for the Call UI.
    if (/^out of minutes\.?$/i.test(message.trim())) {
      this.handlers.onError("Out of minutes.");
    } else if (this.handlers.onConnectFail) {
      this.handlers.onConnectFail(message);
    } else {
      this.handlers.onError(`${message} (voice session ${this.id})`);
    }
    this.stop("error");
  }
}
