import { formatDecayState, isMemoryStoreConfigured, recallForUser } from "@/lib/memory/store";
import { readUserId } from "@/lib/memory/user";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const userId = readUserId(request, url.searchParams.get("userId"));
  if (!userId) {
    return Response.json({ error: "userId is required." }, { status: 400 });
  }
  if (!isMemoryStoreConfigured()) {
    return Response.json({ error: "Memory store is not configured." }, { status: 503 });
  }
  const state = formatDecayState(await recallForUser(userId));
  return Response.json({ userId, state });
}
