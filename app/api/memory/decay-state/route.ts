import { formatDecayState, recallForUser } from "@/lib/memory/store";
import { resolveUserId } from "@/lib/memory/user";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const userId = resolveUserId(request, url.searchParams.get("userId"));
  const lines = await recallForUser(userId);
  return Response.json({ userId, state: formatDecayState(lines) });
}
