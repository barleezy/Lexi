import { after } from "next/server";
import { isDiscordConfigured, isDiscordInboundConfigured } from "@/lib/channels/config";
import {
  DISCORD_APPLICATION_COMMAND,
  DISCORD_DEFERRED_CHANNEL_MESSAGE,
  DISCORD_PING,
  DISCORD_PONG,
  discordPublicKey,
  followupDiscordInteraction,
  isIanDiscordUser,
  parseDiscordInteraction,
  verifyDiscordSignature,
} from "@/lib/channels/discord";
import { handleInboundText } from "@/lib/channels/inbound";

export const maxDuration = 60;

export async function GET() {
  if (!isDiscordInboundConfigured()) {
    return Response.json(
      {
        error: "Discord interactions are not configured.",
        configured: isDiscordConfigured(),
        hint: "Set DISCORD_BOT_TOKEN, DISCORD_USER_ID, and DISCORD_PUBLIC_KEY. Point Discord's Interactions Endpoint URL here. Plain DM inbound needs a gateway host — Vercel cannot keep one.",
      },
      { status: 503 },
    );
  }
  return Response.json({ ok: true, configured: true, inbound: "interactions" });
}

export async function POST(request: Request) {
  const publicKey = discordPublicKey();
  if (!publicKey) {
    return Response.json(
      { error: "Discord interactions are not configured.", configured: false },
      { status: 503 },
    );
  }

  const signature = request.headers.get("x-signature-ed25519") ?? "";
  const timestamp = request.headers.get("x-signature-timestamp") ?? "";
  const raw = await request.text();
  if (!verifyDiscordSignature({ publicKey, signature, timestamp, body: raw })) {
    return new Response("Bad Discord signature.", { status: 401 });
  }

  let body: unknown = {};
  try {
    body = JSON.parse(raw) as unknown;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const interaction = parseDiscordInteraction(body);
  if (!interaction) return Response.json({ error: "Invalid interaction." }, { status: 400 });
  if (interaction.type === DISCORD_PING) {
    return Response.json({ type: DISCORD_PONG });
  }
  if (interaction.type !== DISCORD_APPLICATION_COMMAND) {
    return Response.json({ type: DISCORD_DEFERRED_CHANNEL_MESSAGE });
  }
  if (!isIanDiscordUser(interaction.userId)) {
    return Response.json({
      type: 4,
      data: { content: "I only talk to Ian here.", flags: 64 },
    });
  }

  const text = interaction.text || (interaction.command ? `(used /${interaction.command})` : "");
  if (!text || text.startsWith("(used /")) {
    return Response.json({
      type: 4,
      data: { content: "Say it in the text option — I am here." },
    });
  }

  after(async () => {
    const result = await handleInboundText({
      platform: "discord",
      text,
      sendReply: false,
    });
    const reply = result.ok ? result.reply : result.error || "I could not reply.";
    if (interaction.applicationId && interaction.token) {
      await followupDiscordInteraction({
        applicationId: interaction.applicationId,
        token: interaction.token,
        text: reply,
      });
    }
  });

  return Response.json({ type: DISCORD_DEFERRED_CHANNEL_MESSAGE });
}
