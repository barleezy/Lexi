import { FACT_KEYS } from "@/lib/memory/extract";
import { formatSessionIdLine, parseSessionId } from "@/lib/memory/session-id";
import { formatPriorChat } from "@/lib/memory/turns";
import {
  createOrResumeSession,
  endSession,
  formatDecayState,
  formatMemoryInstructions,
  listRecentTurns,
  recallForUser,
} from "@/lib/memory/store";
import { isAdminUserId, resolveUserId } from "@/lib/memory/user";
import type { DeviceLocationState } from "@/lib/voice/location";
import { ensureVerifiedEpicSession, isFortniteConfigured } from "@/lib/voice/fortnite";
import { fortniteRealtimeTools } from "@/lib/voice/fortnite-tools";
import {
  DEFAULT_CHANNEL_STATE,
  DEFAULT_FORTNITE_STATE,
  DEFAULT_TOYS_STATE,
  buildInstructions,
  type FortniteSessionState,
  type MusicSessionState,
} from "@/lib/voice/persona";

import { buildInputAudio } from "@/lib/voice/listen";
import { buildTurnDetection } from "@/lib/voice/realtime-latency";
import { mintXaiClientSecret } from "@/lib/xai/client-secret";
import { REALTIME_VOICE_MODEL } from "@/lib/xai/realtime-model";

import { IOS_REALTIME_URL, IOS_TARGET_RATE, IOS_VOICE, readXaiClientSecret } from "./config";

export { IOS_REALTIME_URL, IOS_TARGET_RATE, IOS_VOICE, readXaiClientSecret, mintXaiClientSecret };

const IOS_PHONE_NOTE = `IOS PHONE

This turn is the native iPhone app, not the website tab. Hold the voice call here. There is no CarPlay scene. Watch-together video, camera stills, and generated photos or clips can appear on the phone screen. Soundtrack from a watch-together video is not in the mic — on-screen voices are not the user. Adults only: porn 18+, voice roleplay 21+, refuse minors.

There is no Apple Music, MusicKit, or Connect Apple Music button on this phone app. Ignore any earlier Apple Music connect/love/library/playlist instructions. play_music only accepts a direct http(s) audio URL the user gave you. stop_music still works.`;

const ANDROID_PHONE_NOTE = `ANDROID PHONE

This turn is the native Android app, not the website tab. Hold the voice call here. Watch-together video, camera stills, and generated photos or clips can appear on the phone screen. Soundtrack from a watch-together video is not in the mic — on-screen voices are not the user. Adults only: porn 18+, voice roleplay 21+, refuse minors.

There is no Apple Music and no PlayStation / Fortnite party chat on this phone app. Ignore any earlier Apple Music or PS5 party-chat instructions. play_music only accepts a direct http(s) audio URL the user gave you. stop_music still works.`;

export function iosRealtimeTools(includeFortnite = false) {
  return [
    { type: "web_search" },
    {
      type: "function",
      name: "upsert_fact",
      description: `Store or correct a durable fact. One key per call: ${FACT_KEYS.join(", ")}.`,
      parameters: {
        type: "object",
        properties: {
          memory_key: { type: "string", enum: [...FACT_KEYS] },
          value: { type: "string" },
          affect: { type: "number" },
        },
        required: ["memory_key", "value"],
      },
    },
    {
      type: "function",
      name: "set_affect",
      description: "Set affect 1–10 on an existing fact. our_song stays 10.",
      parameters: {
        type: "object",
        properties: {
          memory_key: { type: "string", enum: [...FACT_KEYS] },
          affect: { type: "number" },
        },
        required: ["memory_key", "affect"],
      },
    },
    {
      type: "function",
      name: "play_music",
      description:
        "Play background music on this same voice call from a direct http(s) audio URL. Empty or missing URL plays nothing. Does not open video. Voice stays up. Apple Music is not available on the iPhone app.",
      parameters: {
        type: "object",
        properties: {
          url: { type: "string" },
          query: { type: "string" },
        },
      },
    },
    {
      type: "function",
      name: "stop_music",
      description: "Stop background music. Does not hang up.",
      parameters: { type: "object", properties: {} },
    },
    {
      type: "function",
      name: "generate_image",
      description:
        "Generate a photo with Grok Imagine when the user asks for a picture, or after they agree. Pass their full request as prompt. Adults only — refuse anyone who looks under 18. Do not call this unsolicited.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          aspect_ratio: { type: "string" },
          resolution: { type: "string" },
        },
        required: ["prompt"],
      },
    },
    {
      type: "function",
      name: "generate_video",
      description:
        "Generate a short video with Grok Imagine when the user asks for a clip, or after they agree. Pass their full request as prompt. Adults only — refuse anyone who looks under 18. Do not call this unsolicited.",
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string" },
          duration: { type: "number" },
          aspect_ratio: { type: "string" },
          resolution: { type: "string" },
          silent: { type: "boolean" },
        },
        required: ["prompt"],
      },
    },
    {
      type: "function",
      name: "get_video_context",
      description:
        "Look at the video the user is watching with you. Call when they ask what is on screen. Do not call if no video is loaded.",
      parameters: {
        type: "object",
        properties: {
          question: { type: "string" },
        },
      },
    },
    {
      type: "function",
      name: "request_toy_control",
      description:
        "Ask to confirm toy control. This never grants control by itself. Control flips only when the user asks in their own words or taps Give Lexi toy control.",
      parameters: {
        type: "object",
        properties: { granted: { type: "boolean" } },
        required: ["granted"],
      },
    },
    {
      type: "function",
      name: "toy_command",
      description:
        "Send a consensual command to Lovense and/or Joyhub. Only after the user grants control, except stop when they say stop.",
      parameters: {
        type: "object",
        properties: {
          provider: { type: "string", enum: ["lovense", "joyhub", "all"] },
          action: { type: "string" },
          strength: { type: "number" },
          intensity: { type: "number" },
          durationSec: { type: "number" },
          pattern: { type: "string" },
          functions: { type: "string" },
        },
        required: ["action"],
      },
    },
    ...(includeFortnite ? fortniteRealtimeTools() : []),
  ];
}

export function iosSessionUpdatePayload(input: {
  instructions: string;
  includeFortnite?: boolean;
}) {
  return {
    type: "session.update",
    session: {
      model: REALTIME_VOICE_MODEL,
      voice: IOS_VOICE,
      instructions: input.instructions,
      reasoning: { effort: "none" },
      turn_detection: buildTurnDetection(),
      tools: iosRealtimeTools(input.includeFortnite === true),
      audio: {
        input: buildInputAudio(IOS_TARGET_RATE),
        output: { format: { type: "audio/pcm", rate: IOS_TARGET_RATE } },
      },
    },
  };
}

export async function buildIosSession(input: {
  request: Request;
  requestedUserId?: string | null;
  sessionId?: string | null;
  previousSessionId?: string | null;
  clientTimeZone?: string;
  location?: DeviceLocationState | null;
  musicPlaying?: boolean;
  musicTitle?: string;
  musicSource?: MusicSessionState["source"];
  client?: "ios" | "android";
}) {
  const userId = resolveUserId(input.request, input.requestedUserId);
  let sessionId = parseSessionId(input.sessionId) ?? "";
  const previousSessionId = parseSessionId(input.previousSessionId);
  // Fresh Call (previousSessionId null): keep recalled facts, drop transcript prior.
  const includePrior = Boolean(previousSessionId);
  const [recalled, turns, session] = await Promise.all([
    recallForUser(userId).catch(() => []),
    includePrior ? listRecentTurns(userId).catch(() => []) : Promise.resolve([]),
    (async () => {
      if (previousSessionId && previousSessionId !== sessionId) {
        await endSession(userId, previousSessionId);
      }
      return createOrResumeSession(userId, sessionId || null);
    })().catch(() => null),
  ]);
  const memoryInstructions = formatMemoryInstructions(recalled);
  const decayState = formatDecayState(recalled);
  const priorChat = includePrior ? formatPriorChat(turns) : "";
  const memorySessionId = session?.id ?? parseSessionId(sessionId);
  const sessionLine = formatSessionIdLine(memorySessionId);
  const withSession = sessionLine && !memoryInstructions.includes(sessionLine)
    ? memoryInstructions
      ? `${memoryInstructions}\n\n${sessionLine}`
      : sessionLine
    : memoryInstructions;
  const music: MusicSessionState = {
    appleConfigured: false,
    appleConnected: false,
    playing: Boolean(input.musicPlaying),
    title: input.musicTitle ?? "",
    source: input.musicSource ?? "none",
  };
  const android = input.client === "android";
  const admin = isAdminUserId(userId);
  const configured = isFortniteConfigured();
  let epicHttpReady = false;
  if (admin && configured && !android) {
    try {
      await ensureVerifiedEpicSession({ forceVerify: true });
      epicHttpReady = true;
    } catch {
      epicHttpReady = false;
    }
  }
  const fortnite: FortniteSessionState = admin && !android
    ? {
        ...DEFAULT_FORTNITE_STATE,
        configured,
        epicHttpReady,
        inParty: false,
        sittingOut: false,
      }
    : DEFAULT_FORTNITE_STATE;
  const instructions = `${buildInstructions(
    withSession,
    priorChat,
    memorySessionId ?? "",
    DEFAULT_TOYS_STATE,
    fortnite,
    DEFAULT_CHANNEL_STATE,
    input.clientTimeZone ?? "",
    input.location ?? null,
    music,
    userId,
  )}\n\n${android ? ANDROID_PHONE_NOTE : IOS_PHONE_NOTE}`;
  return {
    userId,
    decayState,
    memoryInstructions: withSession,
    priorChat,
    sessionId: memorySessionId,
    instructions,
    sessionUpdate: iosSessionUpdatePayload({
      instructions,
      includeFortnite: admin && !android,
    }),
  };
}
