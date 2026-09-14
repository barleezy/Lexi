import { recallForUser, upsertMemory } from "@/lib/memory/store";
import { resolveUserId } from "@/lib/memory/user";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const userId = resolveUserId(request, url.searchParams.get("userId"));
  const lines = await recallForUser(userId);
  return Response.json({ userId, memories: lines });
}

export async function POST(request: Request) {
  let body: {
    userId?: unknown;
    memoryKey?: unknown;
    rawText?: unknown;
    weightedText?: unknown;
    startSalience?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const userId = resolveUserId(
    request,
    typeof body.userId === "string" ? body.userId : null,
  );
  const memoryKey = typeof body.memoryKey === "string" ? body.memoryKey.trim() : "";
  const rawText = typeof body.rawText === "string" ? body.rawText.trim() : "";
  const startSalience = Number(body.startSalience);
  if (!memoryKey || !rawText || !Number.isFinite(startSalience)) {
    return Response.json({ error: "memoryKey, rawText, and startSalience are required." }, { status: 400 });
  }

  const row = await upsertMemory({
    userId,
    memoryKey,
    rawText,
    weightedText: typeof body.weightedText === "string" ? body.weightedText : undefined,
    startSalience,
  });
  if (!row) {
    return Response.json({ error: "Memory store is not configured." }, { status: 503 });
  }
  return Response.json({ memory: row });
}
