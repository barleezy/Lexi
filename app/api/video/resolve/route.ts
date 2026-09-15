import { resolveAdultWatchPage } from "@/lib/voice/watch-resolve";

export const maxDuration = 30;

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("url");
  const resolved = await resolveAdultWatchPage(raw ?? "");
  if (!resolved.ok) {
    return Response.json(
      { error: resolved.error, embedUrl: resolved.embedUrl || "" },
      { status: 400 },
    );
  }
  return Response.json({
    title: resolved.result.title,
    mediaUrl: resolved.result.mediaUrl,
    kind: resolved.result.kind,
    embedUrl: resolved.result.embedUrl,
    pageUrl: resolved.result.pageUrl,
  });
}
