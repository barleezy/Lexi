import { parseInboundPayload, type ChannelId } from "./config";
import { replyOnChannel } from "./reply";
import { sendChannelMessage } from "./send";

export { parseInboundPayload };
export type InboundPayload = {
  platform?: unknown;
  channel?: unknown;
  text?: unknown;
  message?: unknown;
  userId?: unknown;
  secret?: unknown;
  replyOnChannel?: unknown;
};

export async function handleInboundText(input: {
  platform: ChannelId | "inbound";
  text: string;
  userId?: string;
  sendReply?: boolean;
}) {
  const text = input.text.trim();
  if (!text) {
    return { ok: false as const, status: 400, error: "text is required." };
  }
  const replied = await replyOnChannel({
    platform: input.platform,
    text,
    userId: input.userId,
  });
  if (!replied.ok) {
    return { ok: false as const, status: replied.status, error: replied.error, reply: "" };
  }

  let sent: { ok: boolean; error?: string } | null = null;
  if (input.sendReply && input.platform !== "inbound") {
    const outbound = await sendChannelMessage({ platform: input.platform, text: replied.reply });
    sent = outbound.ok ? { ok: true } : { ok: false, error: outbound.error };
  }

  return {
    ok: true as const,
    status: 200,
    reply: replied.reply,
    refused: replied.refused,
    persisted: replied.persisted,
    sessionId: "sessionId" in replied ? replied.sessionId : null,
    sent,
    platform: input.platform,
  };
}
