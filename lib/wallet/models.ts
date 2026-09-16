/**
 * Text-only Grok model for memory, summaries, video-context, channels.
 * Never put this on the realtime WebSocket URL (Call stays grok-voice-latest).
 */
export const TEXT_FAST_MODEL = "grok-4-1-fast-reasoning";
export const TEXT_FAST_MAX_TOKENS = 800;

export function textFastModelFromEnv(env: NodeJS.ProcessEnv = process.env) {
  const override = env.XAI_CHAT_MODEL?.trim();
  if (override && /grok-voice|realtime/i.test(override)) {
    return TEXT_FAST_MODEL;
  }
  return override || TEXT_FAST_MODEL;
}
