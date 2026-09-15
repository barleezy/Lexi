import { anyChannelConfigured, inboundSecret, verifyInboundSecret } from "@/lib/channels/config";
import { handleInboundText, parseInboundPayload, type InboundPayload } from "@/lib/channels/inbound";

export const maxDuration = 60;

export async function POST(request: Request) {
  if (!inboundSecret() && !anyChannelConfigured()) {
    return Response.json(
      { error: "No channel inbound secret is configured.", configured: false },
      { status: 503 },
    );
  }

  let body: InboundPayload = {};
  try {
    body = (await request.json()) as InboundPayload;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (inboundSecret() && !verifyInboundSecret(request, body)) {
    return Response.json({ error: "Unauthorized inbound." }, { status: 401 });
  }
  if (!inboundSecret() && !verifyInboundSecret(request, body)) {
    return Response.json(
      { error: "Set CHANNELS_INBOUND_SECRET and send it as x-lexi-channel-secret.", configured: false },
      { status: 503 },
    );
  }

  const parsed = parseInboundPayload(body);
  if (!parsed.userId) {
    return Response.json({ error: "userId is required." }, { status: 400 });
  }
  const result = await handleInboundText({
    platform: parsed.platform ?? "inbound",
    text: parsed.text,
    userId: parsed.userId,
    sendReply: parsed.sendReply && parsed.platform !== null,
  });
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json({
    ok: true,
    reply: result.reply,
    sent: result.sent,
    persisted: result.persisted,
    platform: result.platform,
  });
}
