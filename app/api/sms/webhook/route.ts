import { isSmsConfigured, readEnv } from "@/lib/channels/config";
import { handleInboundText } from "@/lib/channels/inbound";
import { IAN_USER_ID } from "@/lib/memory/user";
import {
  isIanSmsNumber,
  parseTwilioInbound,
  twimlEmpty,
  twimlMessage,
  verifyTwilioSignature,
} from "@/lib/channels/sms";

export const maxDuration = 60;

function webhookUrl(request: Request) {
  const override = readEnv("TWILIO_WEBHOOK_URL");
  if (override) return override;
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto") || url.protocol.replace(":", "");
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || url.host;
  return `${proto}://${host}${url.pathname}${url.search}`;
}

function twiml(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: { "Content-Type": "text/xml" },
  });
}

export async function GET() {
  if (!isSmsConfigured()) {
    return Response.json(
      {
        error: "SMS is not configured.",
        configured: false,
        hint: "Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM, and TWILIO_TO.",
      },
      { status: 503 },
    );
  }
  return Response.json({ ok: true, configured: true, inbound: true });
}

export async function POST(request: Request) {
  if (!isSmsConfigured()) {
    return Response.json(
      { error: "SMS is not configured.", configured: false },
      { status: 503 },
    );
  }

  const raw = await request.text();
  const params = new URLSearchParams(raw);
  const inbound = parseTwilioInbound(params);
  const fields: Record<string, string> = {};
  for (const [key, value] of params.entries()) fields[key] = value;

  const signature = request.headers.get("x-twilio-signature") ?? "";
  if (
    !verifyTwilioSignature({
      authToken: readEnv("TWILIO_AUTH_TOKEN"),
      signature,
      url: webhookUrl(request),
      params: fields,
    })
  ) {
    return twiml(twimlEmpty(), 401);
  }

  if (!inbound.text || !isIanSmsNumber(inbound.from)) {
    return twiml(twimlEmpty());
  }

  const result = await handleInboundText({
    platform: "sms",
    text: inbound.text,
    userId: IAN_USER_ID,
    sendReply: false,
  });
  if (!result.ok) {
    return twiml(twimlMessage("I could not reply just now."), 502);
  }
  return twiml(twimlMessage(result.reply));
}
