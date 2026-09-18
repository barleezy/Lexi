import { VOICE_USD_PER_MINUTE, voiceSecondsToUsd } from "../wallet/voice-rate.ts";

/**
 * Versioned Speech-to-Speech pin. Never use grok-voice-latest — that alias
 * jumps tiers (1.0 → 2.0 on 2026-08-05) and silently changes the bill.
 */
export const REALTIME_VOICE_MODEL = "grok-voice-think-fast-1.0";
export const REALTIME_VOICE_URL = `wss://api.x.ai/v1/realtime?model=${REALTIME_VOICE_MODEL}`;

/** Hard cap: one Call cannot run longer than this, even with leftover minutes. */
export const VOICE_MAX_SESSION_SECONDS = 30 * 60;

/** Kill the Call when estimated xAI audio spend for this session reaches this. */
export const VOICE_MAX_SESSION_SPEND_USD = 5;

/**
 * Published Speech-to-Speech audio rate ($/min). Same billed usage rate as
 * wallet allotment (`VOICE_USD_PER_MINUTE`). Used so the spend guard fires
 * without live usage events.
 */
export const VOICE_USD_PER_AUDIO_MINUTE = VOICE_USD_PER_MINUTE;

export const SESSION_LIMIT_CODE = "session_limit";
export const SESSION_DURATION_MESSAGE = "Call time limit reached.";
export const SESSION_SPEND_MESSAGE = "Call spend limit reached.";

export function estimateVoiceSessionSpendUsd(elapsedSeconds: number) {
  return voiceSecondsToUsd(elapsedSeconds);
}

export function voiceSessionLimitReason(elapsedSeconds: number) {
  const elapsed = Math.max(0, Math.floor(Number(elapsedSeconds) || 0));
  if (elapsed >= VOICE_MAX_SESSION_SECONDS) return "duration" as const;
  if (estimateVoiceSessionSpendUsd(elapsed) >= VOICE_MAX_SESSION_SPEND_USD) {
    return "spend" as const;
  }
  return null;
}

export function voiceSessionLimitError(elapsedSeconds: number) {
  const reason = voiceSessionLimitReason(elapsedSeconds);
  if (reason === "duration") return SESSION_DURATION_MESSAGE;
  if (reason === "spend") return SESSION_SPEND_MESSAGE;
  return null;
}

/** Seconds still allowed by the earlier of the duration and spend caps. */
export function voiceSessionRemainingSeconds(elapsedSeconds: number) {
  const elapsed = Math.max(0, Math.floor(Number(elapsedSeconds) || 0));
  const durationLeft = VOICE_MAX_SESSION_SECONDS - elapsed;
  const spendLeftUsd = VOICE_MAX_SESSION_SPEND_USD - estimateVoiceSessionSpendUsd(elapsed);
  const spendLeftSeconds = Math.floor((spendLeftUsd / VOICE_USD_PER_AUDIO_MINUTE) * 60);
  return Math.max(0, Math.min(durationLeft, spendLeftSeconds));
}

export function assertRealtimeVoiceModel(url: string) {
  if (!url.includes(`model=${REALTIME_VOICE_MODEL}`)) {
    throw new Error(`Realtime URL must use model=${REALTIME_VOICE_MODEL}`);
  }
  if (/grok-voice-latest|grok-4-1-fast|grok-4\.|chat\/completions/i.test(url)) {
    throw new Error("Alias or text models must not be used on the realtime WebSocket URL");
  }
}
