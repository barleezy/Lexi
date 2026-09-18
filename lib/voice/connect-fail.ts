export type VoiceLogPlatform = "web" | "ios" | "android";

export function isVoiceConnectFailure(message: string) {
  const text = message.trim();
  if (!text) return false;
  if (/^out of minutes\.?$/i.test(text)) return false;
  if (/call (time|spend) limit reached/i.test(text)) return false;
  if (/^sign in first\.?$/i.test(text)) return false;
  return true;
}

export function logVoiceConnectFailure(input: {
  reason: string;
  platform: VoiceLogPlatform;
  sessionId?: string | null;
}) {
  const reason = input.reason.trim();
  if (!reason || typeof fetch !== "function") return;
  void fetch("/api/voice/log", {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "ngrok-skip-browser-warning": "1",
    },
    body: JSON.stringify({
      reason,
      platform: input.platform,
      sessionId: input.sessionId ?? undefined,
      kind: "connect.fail",
    }),
    keepalive: true,
  }).catch(() => {
    /* logging must never throw into the chat path */
  });
}
