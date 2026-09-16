import { sweepStaleVoiceSessions } from "@/lib/wallet/voice";

/** Cron-friendly sweeper: settle open voice_sessions older than hold+30s. */
export async function POST() {
  const result = await sweepStaleVoiceSessions();
  return Response.json({ ok: true, ...result });
}

export async function GET() {
  const result = await sweepStaleVoiceSessions();
  return Response.json({ ok: true, ...result });
}
