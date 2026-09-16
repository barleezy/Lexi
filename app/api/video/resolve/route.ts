import { resolveWatchFeed } from "@/lib/voice/watch-feed";

export const maxDuration = 30;

export async function GET(request: Request) {
  try {
    const raw = new URL(request.url).searchParams.get("url");
    const resolved = await resolveWatchFeed(raw ?? "");
    if (!resolved.ok) {
      return Response.json(resolved, { status: 400 });
    }
    return Response.json(resolved);
  } catch {
    return Response.json(
      { ok: false, code: "network", error: "Could not open that video. Check the link and try again." },
      { status: 502 },
    );
  }
}
