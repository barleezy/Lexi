import { anyChannelConfigured, channelStatus } from "@/lib/channels/config";
import { sendChannelMessage } from "@/lib/channels/send";
import { requireAdminUserId } from "@/lib/memory/user";

export const maxDuration = 60;

export async function GET() {
  const platforms = channelStatus();
  return Response.json({
    ok: true,
    any: anyChannelConfigured(),
    platforms,
    inbound: {
      discord: "interactions — no gateway on Vercel",
      telegram: "/api/telegram/webhook",
      sms: "/api/sms/webhook",
      email: "/api/email/inbound",
      generic: "/api/channels/inbound",
    },
  });
}

export async function POST(request: Request) {
  let body: { platform?: unknown; channel?: unknown; text?: unknown; message?: unknown; userId?: unknown } = {};
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!requireAdminUserId(request, typeof body.userId === "string" ? body.userId : null)) {
    return Response.json({ error: "Channel messaging is admin-only." }, { status: 403 });
  }

  const result = await sendChannelMessage(body);
  if (!result.ok) {
    return Response.json(
      { error: result.error, configured: result.configured, platform: result.platform },
      { status: result.status },
    );
  }
  return Response.json({ ok: true, platform: result.platform, via: result.via });
}
