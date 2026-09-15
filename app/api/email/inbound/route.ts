import { inboundSecret, isEmailConfigured, verifyInboundSecret } from "@/lib/channels/config";
import { isIanEmail, parseEmailInbound } from "@/lib/channels/email";
import { handleInboundText } from "@/lib/channels/inbound";
import { IAN_USER_ID } from "@/lib/memory/user";

export const maxDuration = 60;

export async function GET() {
  if (!isEmailConfigured()) {
    return Response.json(
      {
        error: "Email is not configured.",
        configured: false,
        hint: "Set EMAIL_FROM, EMAIL_TO, and RESEND_API_KEY or SMTP_*.",
      },
      { status: 503 },
    );
  }
  return Response.json({ ok: true, configured: true, inbound: true });
}

export async function POST(request: Request) {
  if (!isEmailConfigured()) {
    return Response.json(
      { error: "Email is not configured.", configured: false },
      { status: 503 },
    );
  }

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const record = body && typeof body === "object" ? (body as { secret?: unknown }) : {};
  if (inboundSecret() && !verifyInboundSecret(request, record)) {
    return Response.json({ error: "Unauthorized email inbound." }, { status: 401 });
  }

  const inbound = parseEmailInbound(body);
  if (!inbound.text) {
    return Response.json({ ok: true, ignored: true });
  }
  if (inbound.from && !isIanEmail(inbound.from)) {
    return Response.json({ ok: true, ignored: true });
  }

  const result = await handleInboundText({
    platform: "email",
    text: inbound.text,
    userId: IAN_USER_ID,
    sendReply: true,
  });
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: result.status });
  }
  return Response.json({ ok: true });
}
